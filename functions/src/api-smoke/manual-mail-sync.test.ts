/**
 * Manual mail sync (#177) — route seam over POST /api/gmail/sync.
 *
 * The endpoint is provider-blind, so this is the seam where every decision of
 * the "Pull New Files" button lives: the forced trailing window, its union with
 * real gaps, and the press throttle. Assertions read the documents that come
 * out — which queue items exist, which fields landed on the integration — never
 * which internal function ran. Message copy is deliberately left unpinned.
 *
 * Same harness as route-owner-scoping.test.ts: the real Next handler over an
 * in-memory Firestore, with identity supplied by a stubbed auth seam. The route
 * captures `const db = getAdminDb()` at MODULE load, so the whole suite shares
 * ONE FakeFirestore that we reset() (not recreate) between tests.
 *
 * Runs under vitest.api-smoke.config.ts ONLY (needs root node_modules for
 * next/firebase-admin) — verify via the "App API routes (auth smoke)" CI job.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeFirestore, type DocData } from "./fake-firestore";
import { MANUAL_SYNC_WINDOW_DAYS } from "../mail/constants";

const h = vi.hoisted(() => {
  const box: { db: unknown } = { db: undefined };
  return { box, getDb: () => box.db };
});

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => h.getDb(),
  getAdminApp: () => ({}),
  getAdminStorage: () => ({}),
  getAdminBucket: () => ({}),
}));

vi.mock("@/lib/auth/get-server-user", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/get-server-user")>();
  return {
    ...actual,
    getServerUserIdWithFallback: async (request: Request): Promise<string> => {
      const header = request.headers.get("Authorization");
      if (!header?.startsWith("Bearer ")) throw new actual.UnauthorizedError();
      return header.substring(7);
    },
    isServerUserAdmin: async (): Promise<boolean> => false,
  };
});

const USER = "user-A";
const DAY_MS = 24 * 60 * 60 * 1000;

const store = new FakeFirestore();
h.box.db = store;

beforeEach(() => {
  store.reset();
});

/** Enough of a Timestamp for the route (toDate) and the fake's ordering (toMillis). */
const ts = (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() });

/** A request carrying `uid` as its bearer token (see the auth mock above). */
function authed(uid: string, body: unknown): NextRequest {
  return new NextRequest("http://test.local/api/gmail/sync", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${uid}` },
    body: JSON.stringify(body),
  });
}

const post = async (body: unknown, uid = USER) => {
  const { POST } = await import("@/app/api/gmail/sync/route");
  return POST(authed(uid, body));
};

function seedIntegration(extra: DocData = {}) {
  store.seed("emailIntegrations", "int-1", {
    userId: USER,
    provider: "imap",
    email: "epu@example.at",
    needsReauth: false,
    initialSyncComplete: true,
    ...extra,
  });
}

/** One transaction at `date` — gap detection derives its range from these. */
function seedTransaction(date: Date) {
  store.seed("transactions", "tx-1", { userId: USER, date: ts(date) });
}

async function queueItems() {
  const snap = await store.collection("gmailSyncQueue").where("integrationId", "==", "int-1").get();
  return snap.docs.map((d) => d.data() as DocData);
}

/** Queue documents carry real Admin Timestamps written by the route. */
const at = (v: unknown) => (v as { toDate(): Date }).toDate();
const spanInDays = (item: DocData) =>
  Math.round((at(item.dateTo).getTime() - at(item.dateFrom).getTime()) / DAY_MS);

// ---------------------------------------------------------------------------
// The forced trailing window
// ---------------------------------------------------------------------------
describe("POST /api/gmail/sync — force", () => {
  /** Transaction range fully covered by syncedDateRange ⇒ gap detection finds nothing. */
  const seedFullySynced = () => {
    const txDate = new Date(Date.now() - 30 * DAY_MS);
    seedTransaction(txDate);
    seedIntegration({
      syncedDateRange: {
        from: ts(new Date(txDate.getTime() - 8 * DAY_MS)),
        to: ts(new Date(Date.now() + DAY_MS)),
      },
    });
  };

  it("queues a trailing window even when gap detection finds nothing", async () => {
    seedFullySynced();
    const res = await post({ integrationId: "int-1", force: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    const items = await queueItems();
    expect(items).toHaveLength(1);
    expect(spanInDays(items[0])).toBe(MANUAL_SYNC_WINDOW_DAYS);
    // The window trails *now*, so a receipt that arrived minutes ago is in it.
    expect(at(items[0].dateTo).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("unions the trailing window with real gaps rather than replacing them", async () => {
    // syncedDateRange stops at the transaction date, so the +7d buffer is a gap.
    const txDate = new Date(Date.now() - 30 * DAY_MS);
    seedTransaction(txDate);
    seedIntegration({
      syncedDateRange: {
        from: ts(new Date(txDate.getTime() - 8 * DAY_MS)),
        to: ts(txDate),
      },
    });

    const res = await post({ integrationId: "int-1", force: true });
    expect(res.status).toBe(200);

    const items = await queueItems();
    expect(items).toHaveLength(2);
    // The trailing window is queued first — the mail the user is waiting for
    // beats the historical back-fill.
    expect(spanInDays(items[0])).toBe(MANUAL_SYNC_WINDOW_DAYS);
    // …and the real gap (ending 7 days after the transaction) survives.
    const gap = items[1];
    expect(at(gap.dateFrom).getTime()).toBeGreaterThanOrEqual(txDate.getTime());
    expect(at(gap.dateTo).getTime()).toBeCloseTo(txDate.getTime() + 7 * DAY_MS, -4);
  });

  it("without force, an already-synced range still reports up to date (Gmail button unchanged)", async () => {
    seedFullySynced();
    const res = await post({ integrationId: "int-1" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, alreadySynced: true });
    expect(await queueItems()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The press throttle
// ---------------------------------------------------------------------------
describe("POST /api/gmail/sync — throttle", () => {
  const seedPressable = (extra: DocData) => {
    const txDate = new Date(Date.now() - 30 * DAY_MS);
    seedTransaction(txDate);
    seedIntegration({
      syncedDateRange: {
        from: ts(new Date(txDate.getTime() - 8 * DAY_MS)),
        to: ts(new Date(Date.now() + DAY_MS)),
      },
      ...extra,
    });
  };

  it("refuses a second press inside five minutes", async () => {
    seedPressable({ lastManualSyncAt: ts(new Date(Date.now() - 60_000)) });
    const res = await post({ integrationId: "int-1", force: true });

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(await queueItems()).toHaveLength(0);
  });

  it("does not throttle on a recent worker-written lastSyncAt (the nightly run)", async () => {
    seedPressable({ lastSyncAt: ts(new Date(Date.now() - 60_000)) });
    const res = await post({ integrationId: "int-1", force: true });

    expect(res.status).toBe(200);
    expect(await queueItems()).toHaveLength(1);
  });

  it("allows a press once the previous one is older than five minutes", async () => {
    seedPressable({ lastManualSyncAt: ts(new Date(Date.now() - 10 * 60_000)) });
    const res = await post({ integrationId: "int-1", force: true });

    expect(res.status).toBe(200);
    expect(await queueItems()).toHaveLength(1);
  });

  it("stamps lastManualSyncAt at enqueue time, not on completion", async () => {
    seedPressable({});
    const res = await post({ integrationId: "int-1", force: true });
    expect(res.status).toBe(200);

    const after = (await store.collection("emailIntegrations").doc("int-1").get()).data()!;
    expect(after.lastManualSyncAt).toBeTruthy();
    expect(at(after.lastManualSyncAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Nothing has run the sync yet — the stamp landed with the queue item.
    const items = await queueItems();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("pending");
  });
});
