# W1 — Better Auth: implementation (spec done, suites are the contract)

Successor to the W1 spec handoff (fulfilled 2026-07-21, deleted). The spec
session measured the surface and encoded acceptance as xfail suites —
**PR #19** (`w1-better-auth-spec`). Implementation is DONE when every
`it.fails` mark in those suites is removed and CI stays green. Do not
weaken a characterization test to make an implementation fit; if one seems
wrong, stop and flag it.

## What the spec found (trust these numbers)

- The aliased frontend consumes exactly **25 symbols from `firebase/auth`**
  across 9 files; `components/auth/auth-provider.tsx` is the main consumer.
  Pinned in `functions/src/selfhost/auth-client.test.ts` (17 pass, 3 xfail).
- **14 functions files** consume `firebase-admin/auth` via the
  `auth-shim.ts` alias: `getUser` ×13, plus `getUserByEmail`, `listUsers`,
  `deleteUser`, `setCustomUserClaims`, and — **missing from today's shim** —
  `updateUser`, `generatePasswordResetLink`, `createCustomToken`. Most
  heavy consumers are in the selfhost manifest's `EXCLUDED_EXPORTS`; check
  before widening the shim surface.
- **44 of the 61 `app/api/*` routes** authenticate via
  `lib/auth/get-server-user.ts` (verified-token helper since the
  2026-07-21 auth-verify fix). Their `if (!userId) return 401` branches
  are **dead code** — the helper throws, generic catches answer **500**,
  and `sources/[id]/disconnect` + `plaid/link-token` echo the internal
  error message. Pinned/xfailed in `functions/src/api-smoke/auth-routes.test.ts`
  (new CI job "App API routes (auth smoke)").

## The seam (defined by `better-auth.test.ts`, keep it this small)

```ts
// functions/src/selfhost/better-auth.ts
export interface SelfhostAuth {
  handler: (req: Request) => Promise<Response>; // Better Auth fetch handler
  verifier: TokenVerifier;                      // plugs into createHost()
  provisionUser(opts: { uid?; email; password?; displayName?; admin? }):
    Promise<{ uid: string }>;                   // also the W2/W3 migration entry
  signInEmail(email, password): Promise<{ token: string }>;
}
export function createSelfhostAuth(): Promise<SelfhostAuth>;
```

`provisionUser` exists because the product is invite-only: users are
provisioned, never self-registered — and W2's migration needs exactly this
entry point with a caller-provided uid.

## Implementation chunks (small PRs, in order)

1. **Server core** — add the `better-auth` dependency (functions/), schema
   via the existing `functions/drizzle/` + `db/migrate.ts` path (ONE code
   path for PGlite and node-postgres; no auth container). Implement
   `createSelfhostAuth()`: email/password, org plugin, caller-provided user
   ids (Firebase-shaped fixture uid must round-trip), `verifier`. Flip the
   first ~5 marks in `better-auth.test.ts`.
2. **Invite-only + admin claims port** — `allowedEmails` gate (same data
   the Firebase build maintains), `SUPER_ADMIN_EMAIL` auto-admin,
   `setCustomUserClaims` persistence; rewrite `auth-shim.ts` over the real
   store (real records, working `verifyIdToken`, session-killing
   `deleteUser`). Flip the remaining server marks incl. the data-plane
   owner-scoping test.
3. **Host wiring** — mount `handler` on the host (e.g. `/__auth`, same
   collision-free namespace trick as `/__data`); extend
   `server.ts#resolveVerifier` precedence to `FIBUKI_DEV_UID` → external
   `OIDC_ISSUER` (unchanged, self-hosters keep Authentik/Keycloak/Entra) →
   **Better Auth built-in (new default)**. `oidc-verifier.ts` and its test
   must not regress.
4. **Client rewrite** — `lib/selfhost/auth-client.ts` over the Better Auth
   endpoints: keep all 25 symbols and every pinned behavior (session
   restore, listener semantics, stable User identity, cross-tab sync, dev
   short-circuit, FirebaseError shapes), add `__configureAuthClient` (same
   pattern as `__configureFirestoreClient`), make
   `signInWithEmailAndPassword` a real credential sign-in and
   `signInWithPopup(GoogleAuthProvider)` the social flow. Flip the 3
   client marks. Integration shape: boot `createSelfhostAuth().handler`
   over a socket in the test, like `firestore-client.test.ts` does.
5. **401 contract** — unauthenticated `app/api/*` requests answer
   `401 {"error":"Unauthorized"}` instead of 500 (one change in
   `get-server-user.ts` callers' shape or a helper variant — no internal
   message leak). Flip the api-smoke xfails. Touches the Firebase build —
   needs the decision below first.

## Decisions for Stefan (check in place, then log to docs/decisions.md)

- [a] **Session-token shape:** (a) Better Auth JWT plugin — `getIdToken()`
      stays a locally-decodable JWT, host verifies via JWKS with the same
      machinery `oidc-verifier.ts` already has (recommended; the client
      suite pins JWT-decodable tokens) — or (b) opaque session token +
      server-side `getSession` lookup per request (client suite's token
      tests would need reworking). **(a) recommended.**
- [Social Provider] **Google sign-in on selfhost:** Better Auth's Google social provider,
      BYO OAuth client via env (matches "same features, bring your own
      OAuth" from who-is-this-for) — or defer Google entirely to an
      external OIDC front. **Social provider recommended** (W1 goal names
      email/password + Google).
- [x] **401-shaping chunk (5):** approve changing unauthenticated route
      responses 500 → 401 on the Firebase build (also stops the error-text
      leak in two routes).
- [keep] **Ported registration callables:** keep `validateRegistration` /
      `setAdminClaim` / `listAdmins` / `sendPasswordReset` etc. in
      `EXCLUDED_EXPORTS` with Better Auth-native equivalents
      (recommended), or un-exclude and port them.
- [Revisit] **Next API routes under selfhost:** the auth-verify decision handoff
      says they're not part of the selfhost data plane (no branch point),
      but the selfhost UI does call some of them (`chat`, `gmail/*`).
      Confirm: out of W1, revisit at W3/W4? The spec suite deliberately
      encodes nothing here.

## Hard constraints (unchanged from the accepted phase-2 doc)

Uid preservation (callers provide ids; migration rewrites zero rows) ·
zero app-code changes, no `if (selfHosted)` in business logic — the alias
is the seam · Firebase build stays untouched and green (dual-backend until
W4) · no auth container · OIDC stays pluggable · `db/tenant.ts` and RLS
backstop assumptions unchanged (multi-USER, still one tenant in selfhost).

## Non-goals

No cutover/DNS (W4, blocked on Felix, back 2026-07-26), no Firestore-API
removal (W5), no reconciliation backfill (W6), no Electric/pg-boss/billing
(Phase 3), no scrypt import (forced reset accepted — two users).

## Guardrails (this host)

Scoped runs only (`node node_modules/.bin/<runner> run <file> --pool=forks
--maxWorkers=1` — the guard hook text-matches the runner's name anywhere in
a command, including filenames: stage by directory, use `-F`/`--body-file`).
**No npm on the audit box** — the `better-auth` install (chunk 1) must
happen on CT 999 or a workstation, or land via a PR whose lockfile change
someone else installs. Root `node_modules` is empty here: the api-smoke
profile only runs in CI. Full suites on CT 999/CI. Code → PR + CI +
adversarial review + explicit merge OK; handoffs/docs → straight to main.
