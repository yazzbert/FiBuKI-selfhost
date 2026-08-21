/**
 * Route-seam smoke over POST /api/mail/imap/connect (spec #173, #176).
 *
 * This is the flow every new IMAP mailbox goes through, and it was untested
 * until #176 lifted its error classifier out into
 * functions/src/mail/imap/classifyImapError.ts so the sync worker could reach
 * the same vocabulary. A silent regression here would not surface until a user
 * tried to connect a mailbox, so the move brings its own pin.
 *
 * What is pinned is the route's *decision* on a rejected login — a classified
 * 400 carrying the code, and nothing written — not the copy. Exact wording is
 * deliberately left loose so a reword does not break a test.
 *
 * Same harness as gmail-sync-manual-window.test.ts: the REAL Next handler over
 * an in-memory Firestore, so this needs the ROOT dependency tree and runs in
 * the "App API routes (auth smoke)" CI job.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeFirestore } from "./fake-firestore";

// The connect route binds `getAdminDb()` once at module import, so every test
// must see the SAME instance. Held in a hoisted box the vi.mock factory reaches.
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

// The bearer token IS the uid; a missing/non-Bearer header still 401s.
vi.mock("@/lib/auth/get-server-user", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/get-server-user")>();
  return {
    ...actual,
    getServerUserIdWithFallback: async (request: Request): Promise<string> => {
      const header = request.headers.get("Authorization");
      if (!header?.startsWith("Bearer ")) throw new actual.UnauthorizedError();
      return header.substring(7);
    },
  };
});

/** What the next `client.connect()` throws. Set per test. */
let connectError: unknown = null;

// Path-relative on purpose: this reaches <repo root>/node_modules/imapflow,
// the copy the route binds to. functions/ has its own physical copy, and a
// bare `imapflow` specifier here would intercept that one instead — i.e.
// nothing. The negative control is a real DNS lookup to mail.example.at.
vi.mock("../../../node_modules/imapflow", () => ({
  ImapFlow: class {
    async connect(): Promise<void> {
      throw connectError;
    }
    async getMailboxLock(): Promise<{ release: () => void }> {
      return { release: () => {} };
    }
    async logout(): Promise<void> {}
    close(): void {}
  },
}));

const USER = "user-A";

const store = new FakeFirestore();
h.box.db = store;

beforeEach(() => {
  store.reset();
  connectError = null;
});

/** Well-formed credentials — every failure below comes from the server, not validation. */
const CREDENTIALS = {
  host: "mail.example.at",
  port: 993,
  secure: true,
  user: "epu@example.at",
  password: "revoked-app-password",
  mailbox: "INBOX",
};

async function callConnect(body: unknown) {
  const { POST } = await import("@/app/api/mail/imap/connect/route");
  return POST(
    new NextRequest("http://test.local/api/mail/imap/connect", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${USER}`,
      },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/mail/imap/connect", () => {
  it("still answers a classified 400 when the server rejects the login", async () => {
    // The shape imapflow throws on a server NO to LOGIN: a bare "Command
    // failed" message with the reason on the error object.
    connectError = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
      serverResponseCode: "AUTHENTICATIONFAILED",
      responseText: "Invalid credentials",
    });

    const res = await callConnect(CREDENTIALS);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.code).toBe("auth_failed");
    // Copy is not pinned — only that the user gets classified text rather than
    // the library's own "Command failed".
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toBe("Command failed");
  });

  it("persists nothing when verification fails", async () => {
    connectError = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
    });

    await callConnect(CREDENTIALS);

    expect((await store.collection("emailIntegrations").get()).empty).toBe(true);
    expect((await store.collection("emailTokens").get()).empty).toBe(true);
  });
});
