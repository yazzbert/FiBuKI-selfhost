# Pre-cutover hardening — implementation brief

**Goal:** close the auth carry-overs and Phase-0 test gaps that ride into the
W4 cutover, so the flip happens on tested code rather than known-soft paths.
None of this is on the W4 critical path (that's Felix's hosting decision) — it
is the "make the two-user cutover safe" work that can land while W4 is blocked.

**Status when written (2026-07-22):** W1-W3 done and merged (main @ 7358610c);
W4 blocked on Felix (back 2026-07-26). This is the recommended next chunk.

**Read first:**
- `handoffs/2026-07-22-w1-outcome.md` — the carry-over source (Follow-ups) and
  the auth env/operational notes.
- `docs/phase-2-rip-the-shim.md` "Phase-0 gates that predate any cutover".
- `docs/w4-cutover-runbook.md` — where these gaps show up at flip time (its
  "Open carry-overs" section lists the auth ones).
- Source: `src/selfhost/better-auth.ts` (`provisionUser`, `selfhostAuth()`
  promise-memo, `listUsers`), `src/selfhost/server.ts` (social callback /
  `/__auth` mount), the shared login UI, `functions/src/.../gmailSyncQueue.ts`
  (~L244-307 provider fork), and the `app/api/*` routes.

## Scope — three PR-sized sub-chunks, in this order

### A. Auth test coverage (lowest risk, highest value — do first)
Pure tests, no behavior change. Under the selfhost profile
(`vitest.selfhost.config.ts`):
- **Google/social sign-in path** — the one path with zero coverage and the
  migration path for the Google user. Cover: successful social sign-in →
  JWT → data plane; the invite gate firing as the `user.create` DB hook
  (invited allowed, non-invited rejected). This is the regression net for a
  better-auth version bump.
- **Deferred LOWs from #21** (write the failing test, then fix):
  - `selfhostAuth()` promise-memo poisons on a transient boot failure — a
    first-call failure caches the rejected promise so every later call fails.
    Test transient-failure-then-recovery; fix to not memoize a rejection.
  - `listUsers` omits `pageToken` — export/enumeration truncates at one page.
    Test >1 page; thread the token (this also hardens `migrate-export`'s user
    enumeration for a larger tenant).

### B. Auth UX fixes (behavior changes — smaller, careful PRs)
Each needs a test pinning the new behavior:
- **Non-invited Google users fail silently** — add the selfhost equivalent of
  the Firebase build's `submitAccessRequest` / "access requested" banner, so a
  non-invited social sign-in gets a clear "access requested" outcome instead of
  a silent dead end.
- **Login page GitHub button is a dead control under selfhost** — gate it in
  the shared UI on `FIBUKI_BACKEND` (hide/disable when selfhost).
- **Mid-pickup reload strands a live server session** — the social callback
  marker is stripped before the async pickup completes, so a reload mid-pickup
  forces re-login. Fix the ordering so the marker survives until pickup lands.

### C. Phase-0 route + queue test gaps
- **`app/api/*` route smoke suite** — W1 #24 already added a 401-contract on 43
  routes; this is the *functional* smoke layer over the data-plane/auth-swap
  routes (happy-path + owner-scoping), the ones that carry the cutover.
- **`gmailSyncQueue.ts` provider fork (~L244-307)** — an untested branch that
  differs per backend; test both legs before it runs on the new stack for real
  users.

## Non-goals
- The W4 cutover itself (Felix-blocked), W5/W6 shim teardown, Electric/pg-boss
  (Phase 3), License + CLA (separate human decision).
- Rewriting retrieval to Drizzle — these routes keep speaking the shim; this is
  coverage + auth-UX, not the "rip".

## Guardrails
- Host safety (6 GiB box): scoped runs only
  (`npx vitest run <file> --config vitest.selfhost.config.ts --pool=forks
  --maxWorkers=1`), scoped `tsc` (`NODE_OPTIONS=--max-old-space-size=900 ...
  --ignoreConfig`); the guard hook matches command TEXT, so pass commit
  messages via `-F`/`--body-file`. Max 2 concurrent sub-agents.
- Tests-first (rewrite-goals). Characterization suites pin real behavior —
  port, never regenerate; never "fix" a pinned value without Stefan.
- Branch from main; small conventional commits; CI-green AND adversarially
  reviewed before asking to merge; merge only on Stefan's explicit
  go-ahead (do not self-merge).
