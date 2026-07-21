/**
 * W1 (Better Auth) — client shim surface suite for lib/selfhost/auth-client.ts.
 *
 * Closes the named Phase-0 gap (858 LOC, zero tests) by pinning the
 * `firebase/auth` surface the aliased frontend actually consumes, measured
 * across every `from "firebase/auth"` import in app/, components/, hooks/,
 * lib/ (9 files, 25 symbols — see handoffs/2026-07-21-w1-better-auth-impl.md).
 *
 * Two kinds of test:
 *  - Characterization (plain `it`): behavior the Better Auth rewrite MUST
 *    preserve. Mechanism-agnostic on purpose — no OIDC/Authentik specifics
 *    are pinned, only the module surface, session semantics, and error
 *    shapes the app observes.
 *  - Acceptance (`it.fails`, ⚠ xfail): behavior the rewrite must ADD. Green
 *    today because the test fails; the implementation removes the `.fails`
 *    marks. Done means: all marks removed, suite green.
 *
 * auth-client is browser code; there is no DOM package in this tree, so a
 * minimal hand-rolled `window` (localStorage/sessionStorage/location/history/
 * storage events — the only APIs the module touches) is installed before the
 * module loads. That keeps the suite runnable under the plain Node profile.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

type AuthClient = typeof import("../../../lib/selfhost/auth-client");

/* ------------------------------------------------------------------ */
/* Minimal browser environment                                         */
/* ------------------------------------------------------------------ */

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

interface FakeWindow {
  localStorage: FakeStorage;
  sessionStorage: FakeStorage;
  location: {
    origin: string;
    pathname: string;
    search: string;
    href: string;
    assign: (url: string) => void;
    assigned: string[];
  };
  history: { replaceState: (data: unknown, unused: string, url?: string) => void };
  addEventListener: (type: string, cb: (e: unknown) => void) => void;
  removeEventListener: (type: string, cb: (e: unknown) => void) => void;
  __listeners: Map<string, Array<(e: unknown) => void>>;
}

function installWindow(): FakeWindow {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const w: FakeWindow = {
    localStorage: new FakeStorage(),
    sessionStorage: new FakeStorage(),
    location: {
      origin: "https://app.selfhost.test",
      pathname: "/transactions",
      search: "",
      href: "https://app.selfhost.test/transactions",
      assigned: [],
      assign(url: string) {
        this.assigned.push(url);
      },
    },
    history: { replaceState: () => undefined },
    addEventListener(type, cb) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    removeEventListener(type, cb) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== cb));
    },
    __listeners: listeners,
  };
  (globalThis as Record<string, unknown>).window = w;
  return w;
}

/* ------------------------------------------------------------------ */
/* Fake session tokens                                                 */
/*                                                                     */
/* The client never verifies signatures (the HOST does); it only needs */
/* a decodable payload. The rewrite keeps this property: getIdToken()  */
/* returns a JWT-shaped token whose claims the client can read.        */
/* ------------------------------------------------------------------ */

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.fakesig`;
}

const UID = "Kx7RgQ2mNpZcW3vYtLb8HdFs4A2q"; // Firebase-shaped 28-char uid
const IN_AN_HOUR = () => Math.floor(Date.now() / 1000) + 3600;

function sessionTokens(extra: Record<string, unknown> = {}) {
  const id_token = makeJwt({
    sub: UID,
    email: "stefan@example.test",
    name: "Stefan Test",
    email_verified: true,
    exp: IN_AN_HOUR(),
    iat: Math.floor(Date.now() / 1000),
    ...extra,
  });
  return { id_token, expires_at: Date.now() + 3600_000 };
}

/** Wait for queued microtasks (onAuthStateChanged notifies via microtask). */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/* ------------------------------------------------------------------ */
/* Module loading (env is read at import time)                         */
/* ------------------------------------------------------------------ */

let fakeWindow: FakeWindow;
let client: AuthClient;

async function loadClient(env: Record<string, string | undefined> = {}): Promise<AuthClient> {
  vi.resetModules();
  fakeWindow = installWindow();
  const keys = [
    "NEXT_PUBLIC_FIBUKI_DEV_UID",
    "NEXT_PUBLIC_FIBUKI_DEV_ADMIN",
    "NEXT_PUBLIC_OIDC_ISSUER",
    "NEXT_PUBLIC_OIDC_CLIENT_ID",
  ];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  return import("../../../lib/selfhost/auth-client");
}

describe("selfhost auth-client — firebase/auth surface (W1 spec)", () => {
  beforeAll(async () => {
    client = await loadClient();
  });

  afterEach(async () => {
    // Sign out between tests so session state can't leak.
    client.__setSelfhostSession(null);
    await tick();
  });

  /* ---------------- module surface ---------------- */

  describe("exports consumed by the aliased frontend", () => {
    it("exposes every value symbol the app imports from firebase/auth", () => {
      // Measured 2026-07-21 across the 9 importing files. Type-only imports
      // (User, MultiFactorInfo, TotpSecret) compile against this module and
      // are covered by the functions tsc job.
      const fns = [
        "getAuth",
        "connectAuthEmulator",
        "setPersistence",
        "onAuthStateChanged",
        "signOut",
        "signInWithEmailAndPassword",
        "signInWithPopup",
        "signInWithCustomToken",
        "getMultiFactorResolver",
        "multiFactor",
        "linkWithCredential",
        "linkWithPopup",
        "linkWithRedirect",
        "unlink",
      ] as const;
      for (const name of fns) expect(typeof client[name], name).toBe("function");

      const classes = ["GoogleAuthProvider", "GithubAuthProvider", "OAuthProvider", "MultiFactorError", "MultiFactorResolver"] as const;
      for (const name of classes) expect(typeof client[name], name).toBe("function");

      expect(client.browserLocalPersistence).toBeTruthy();
      expect(typeof client.PhoneMultiFactorGenerator.assertion).toBe("function");
      expect(typeof client.TotpMultiFactorGenerator.generateSecret).toBe("function");
      expect(client.TotpMultiFactorGenerator.FACTOR_ID).toBe("totp");
    });

    it("getAuth() returns a stable singleton starting signed out", () => {
      const a = client.getAuth();
      expect(client.getAuth()).toBe(a);
      expect(a.currentUser).toBeNull();
    });

    it("connectAuthEmulator and setPersistence are safe no-ops", async () => {
      expect(() => client.connectAuthEmulator(client.getAuth(), "http://x")).not.toThrow();
      await expect(client.setPersistence(client.getAuth(), client.browserLocalPersistence)).resolves.toBeUndefined();
    });
  });

  /* ---------------- error contract ---------------- */

  describe("error contract (app checks err.name / err.code)", () => {
    it("unavailable operations throw FirebaseError-shaped AuthError with an auth/ code", () => {
      try {
        client.multiFactor({});
        expect.unreachable("multiFactor should throw in the selfhost build");
      } catch (e) {
        const err = e as { name: string; code: string; message: string };
        expect(err.name).toBe("FirebaseError");
        expect(err.code).toMatch(/^auth\//);
      }
    });

    it("excluded-page entry points fail loudly (throw or reject) with a FirebaseError", async () => {
      // Sync throw vs async reject is not part of the contract — the pages
      // wrap these in try/catch either way. Both must surface a FirebaseError.
      const expectFailure = async (fn: () => unknown) => {
        try {
          await fn();
          expect.unreachable("expected a FirebaseError");
        } catch (e) {
          expect((e as { name: string }).name).toBe("FirebaseError");
        }
      };
      await expectFailure(() => client.signInWithCustomToken(client.getAuth(), "tok"));
      await expectFailure(() => client.linkWithPopup({}, new client.GoogleAuthProvider()));
      await expectFailure(() => client.TotpMultiFactorGenerator.generateSecret());
    });
  });

  /* ---------------- provider stubs ---------------- */

  describe("provider classes (constructed by auth-provider.tsx and sign-in-security)", () => {
    it("are constructable with the Firebase providerIds and chainable config", () => {
      const g = new client.GoogleAuthProvider();
      expect(g.providerId).toBe("google.com");
      expect(g.addScope("email")).toBe(g);
      expect(g.setCustomParameters({ prompt: "select_account" })).toBe(g);
      expect(new client.GithubAuthProvider().providerId).toBe("github.com");
      expect(new client.OAuthProvider("apple.com").providerId).toBe("apple.com");
    });

    it("credentialFromError returns null (auth-provider's OAuth error path)", () => {
      expect(client.GoogleAuthProvider.credentialFromError(new Error("x"))).toBeNull();
      expect(client.GoogleAuthProvider.credentialFromResult({})).toBeNull();
    });
  });

  /* ---------------- session semantics ---------------- */

  describe("session restore and the User surface", () => {
    it("onAuthStateChanged fires asynchronously once with the current state", async () => {
      const seen: unknown[] = [];
      const unsub = client.onAuthStateChanged(client.getAuth(), (u) => seen.push(u));
      expect(seen).toHaveLength(0); // async like Firebase, never sync
      await tick();
      expect(seen).toEqual([null]);
      unsub();
    });

    it("a restored session yields a User with the mapped profile", async () => {
      client.__setSelfhostSession(sessionTokens());
      await tick();
      const user = client.getAuth().currentUser;
      expect(user).not.toBeNull();
      expect(user!.uid).toBe(UID);
      expect(user!.email).toBe("stefan@example.test");
      expect(user!.displayName).toBe("Stefan Test");
      expect(user!.emailVerified).toBe(true);
      expect(user!.isAnonymous).toBe(false);
      // app code filters user.providerData — exactly one linked provider
      expect(user!.providerData).toHaveLength(1);
      expect(user!.providerData[0].uid).toBe(UID);
    });

    it("getIdToken() resolves a JWT-shaped bearer for the data plane", async () => {
      const tokens = sessionTokens();
      client.__setSelfhostSession(tokens);
      await tick();
      const token = await client.getAuth().currentUser!.getIdToken();
      expect(token).toBe(tokens.id_token);
      expect(token.split(".")).toHaveLength(3);
    });

    it("getIdTokenResult().claims.admin reflects an admin session", async () => {
      client.__setSelfhostSession(sessionTokens({ admin: true }));
      await tick();
      const res = await client.getAuth().currentUser!.getIdTokenResult();
      expect(res.claims.admin).toBe(true);
      expect(res.signInProvider).toBeTruthy();
    });

    it("a non-admin session has no admin claim", async () => {
      client.__setSelfhostSession(sessionTokens());
      await tick();
      const res = await client.getAuth().currentUser!.getIdTokenResult();
      expect(res.claims.admin).not.toBe(true);
    });

    it("keeps the User identity stable across a token update (React refs)", async () => {
      client.__setSelfhostSession(sessionTokens());
      await tick();
      const before = client.getAuth().currentUser;
      client.__setSelfhostSession(sessionTokens()); // same uid, fresh token
      await tick();
      expect(client.getAuth().currentUser).toBe(before);
    });

    it("notifies subscribed listeners on sign-in and sign-out", async () => {
      const seen: Array<string | null> = [];
      const unsub = client.onAuthStateChanged(client.getAuth(), (u) => seen.push(u ? u.uid : null));
      await tick();
      client.__setSelfhostSession(sessionTokens());
      await tick();
      client.__setSelfhostSession(null);
      await tick();
      expect(seen).toEqual([null, UID, null]);
      unsub();
    });

    it("signOut() clears the session, the user, and persisted tokens", async () => {
      client.__setSelfhostSession(sessionTokens());
      await tick();
      const persistedKeys = fakeWindow.localStorage.keys();
      expect(persistedKeys.length).toBeGreaterThan(0);
      await client.signOut(client.getAuth());
      await tick();
      expect(client.getAuth().currentUser).toBeNull();
      for (const k of persistedKeys) expect(fakeWindow.localStorage.getItem(k)).toBeNull();
    });

    it("mirrors a session written by another tab (storage event)", async () => {
      // Contract, not mechanism: whatever key the client persists under,
      // a cross-tab write to that key must be picked up.
      client.__setSelfhostSession(sessionTokens());
      await tick();
      const [key] = fakeWindow.localStorage.keys();
      expect(key).toBeTruthy();
      // Simulate the other tab: replace the stored session, fire the event.
      const other = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1w"; // another Firebase-shaped uid
      fakeWindow.localStorage.setItem(
        key,
        JSON.stringify({ id_token: makeJwt({ sub: other, exp: IN_AN_HOUR() }), expires_at: Date.now() + 3600_000 }),
      );
      for (const cb of fakeWindow.__listeners.get("storage") ?? []) cb({ key });
      await tick();
      expect(client.getAuth().currentUser?.uid).toBe(other);
    });
  });

  /* ---------------- Better Auth acceptance (xfail) ---------------- */

  describe("Better Auth acceptance — ⚠ remove .fails marks when W1 lands", () => {
    it.fails("exposes __configureAuthClient like the sibling data-plane shims", async () => {
      // The rewrite points the client at the selfhost auth backend the same
      // way firestore-client/storage-client are pointed at fibuki-api
      // (__configureFirestoreClient / __configureStorageClient). Tests boot
      // the Better Auth handler over a socket and configure the client here.
      const hook = (client as unknown as Record<string, unknown>).__configureAuthClient;
      expect(typeof hook).toBe("function");
    });

    it.fails("signInWithEmailAndPassword authenticates with the given credentials", async () => {
      // Today the credentials are IGNORED and the browser is redirected to an
      // external IdP (never resolves). Under Better Auth this must become a
      // real credential sign-in that resolves a UserCredential whose uid is
      // the server-side (Firebase-preserved) user id.
      const cred = await Promise.race([
        client.signInWithEmailAndPassword(client.getAuth(), "stefan@example.test", "correct horse"),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sign-in did not resolve")), 250)),
      ]);
      expect(cred.user.uid).toBe(UID);
      expect(cred.operationType).toBe("signIn");
    });

    it.fails("wrong credentials reject with auth/invalid-credential instead of redirecting", async () => {
      // (Today an unconfigured client rejects with auth/invalid-api-key — the
      // assertion is on the CREDENTIAL error so this stays xfail until the
      // real password check exists.)
      await expect(
        Promise.race([
          client.signInWithEmailAndPassword(client.getAuth(), "stefan@example.test", "wrong"),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sign-in did not settle")), 250)),
        ]),
      ).rejects.toMatchObject({ name: "FirebaseError", code: "auth/invalid-credential" });
    });
  });

  /* ---------------- dev short-circuit ---------------- */

  describe("dev short-circuit (NEXT_PUBLIC_FIBUKI_DEV_UID)", () => {
    it("mints a signed-in dev user with no network", async () => {
      const dev = await loadClient({ NEXT_PUBLIC_FIBUKI_DEV_UID: "dev-user-1" });
      const seen: Array<string | null> = [];
      dev.onAuthStateChanged(dev.getAuth(), (u) => seen.push(u ? u.uid : null));
      await tick();
      expect(seen).toEqual(["dev-user-1"]);
      await expect(dev.getAuth().currentUser!.getIdToken()).resolves.toBeTruthy();
      // restore the default module for the rest of the file
      client = await loadClient();
    });
  });
});
