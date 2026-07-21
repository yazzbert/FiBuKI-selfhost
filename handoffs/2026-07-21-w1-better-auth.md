# W1 — Better Auth (server + client)

First Phase-2 workstream, per the accepted
[`phase-2-rip-the-shim.md`](../docs/phase-2-rip-the-shim.md). Runs while
Felix is away (back Sunday 2026-07-26); nothing here blocks on him.

## Goal

Replace the two auth stand-ins with Better Auth, sessions stored in our
Postgres, without changing a line of app code:

- `functions/src/selfhost/auth-shim.ts` — 53-line synthetic single-user
  stub (`getUser` fabricates a record; `verifyIdToken` throws).
- `lib/selfhost/auth-client.ts` — 858 LOC, **zero tests** (named Phase-0
  gap; closing it is part of this workstream, tests before port work).

Done means: a real multi-user login on the selfhost stack (email/password +
Google), the client still presenting the `firebase/auth`-shaped surface the
aliased frontend expects, and the acceptance suite below green with its
xfail marks removed.

## Read first

- [`docs/phase-2-rip-the-shim.md`](../docs/phase-2-rip-the-shim.md) — W1
  section; uid preservation is the critical constraint.
- [`docs/rewrite-goals.md`](../docs/rewrite-goals.md) — stack table: Better
  Auth with the **org plugin** (tenancy primitives), OIDC pluggable, "no
  auth container".
- `lib/selfhost/auth-client.ts` — the covered `firebase/auth` surface, and
  `next.config.ts` (~line 20) for the env-gated alias mechanism.
- `functions/src/selfhost/host.ts` (`TokenVerifier`),
  `oidc-verifier.ts` (+ its test — the existing selfhost token-verify
  path Better Auth absorbs or fronts), `https-shim.ts` (`AuthData`),
  `data-plane.ts` (Bearer enforcement; owner-scoping by uid).
- `CLAUDE.md` auth section — invite-only via `allowedEmails`, admin custom
  claims, `SUPER_ADMIN_EMAIL`.

## Shape of the work

1. **Spec session first** (practices: spec → `/goal`): measure the exact
   `firebase/auth` surface the frontend uses through `auth-client.ts`,
   write the acceptance criteria as an **xfail suite** (client-shim surface
   tests + server session/verify tests + smoke tests for the auth-touching
   `app/api/*` routes — a slice of the 61-routes Phase-0 gap), leave a
   follow-up handoff for the implementation chunks.
2. Implementation lands as small PRs against the suite: server side
   (Better Auth instance, Drizzle schema/migration for its tables, org
   plugin wiring, `TokenVerifier` implementation), then client side
   (auth-client rewrite over Better Auth's client), then the ports of
   invite-only + admin-claims semantics.

## Hard constraints

- **Uid preservation:** Better Auth user ids must be caller-providable so
  migrated users keep their Firebase uids — `userId` is denormalized onto
  essentially every document. Prove it in the suite with a
  fixture user whose id is a Firebase-shaped uid.
- **Zero app-code changes; no `if (selfHosted)` in business logic.** The
  alias trick is the seam, as everywhere else.
- **The Firebase build must stay untouched and green** — dual-backend is
  live until W4. Production fibuki.com auth is not in scope.
- **No auth container** — Better Auth lives in the app process, stores in
  the same Postgres, migrations through the existing `functions/drizzle/`
  + `db/migrate.ts` path (one code path for PGlite and node-postgres).
- **OIDC stays pluggable** for self-hosters (Authentik/Keycloak/Entra);
  don't regress what `oidc-verifier.ts` provides.
- Multi-tenancy: a user's session must resolve to a tenant the same way
  `db/tenant.ts` expects; RLS backstop assumptions unchanged.

## Non-goals

- No cutover work, no DNS, no `new.fibuki.com` (W4, blocked on Felix).
- No Firestore-API removal or registry deletions (W5) and no
  reconciliation backfill (W6).
- No Electric, no pg-boss, no billing (Phase 3).
- No scrypt-hash import — password migration is forced reset (accepted;
  user base is two people).

## Guardrails (this host)

Scoped test runs only (`npx vitest run <file> --pool=forks --maxWorkers=1`),
scoped `tsc` with capped heap, max 2 concurrent sub-agents, full suites on
CT 999 / CI. Code goes through the full PR + CI + adversarial-review +
merge-OK flow; this handoff and docs go straight to `main`.
