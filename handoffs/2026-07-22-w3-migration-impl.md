# W3 — migration tooling: implementation brief

**Goal:** flip every `.fails` mark in
`functions/src/selfhost/migrate-import.test.ts` (10) and
`migrate-import-storage.test.ts` (4) — the W3 acceptance spec landed in
PR #25. Done when both suites are green with the marks removed, in both
selfhost CI jobs (PGlite and compose).

**Read first:** the two spec suites (the seam is fully documented in their
header comments), `docs/phase-2-rip-the-shim.md` §W3,
`handoffs/2026-07-22-w1-outcome.md` (operational constraints),
`functions/src/selfhost/wire-values.ts`, `db/migrate.ts`,
`better-auth.ts` (`provisionUser`), `storage-shim.ts`.

## Context

W3 per the accepted phase-2 plan, with W2 collapsed in (user base is
exactly two; forced password reset accepted — migrated users are
provisioned **passwordless**). The export/import split is an ops
constraint, not taste: Firebase Admin credentials never live on the
audit box, so a creds-side exporter emits a self-contained dump
directory and the importer consumes it against the selfhost stack.

Tenancy clarification (supersedes the phase-2 doc's "every migrated user
lands as a tenant" wording): W1 shipped **one tenant, owner-scoped by
uid** — migration imports everything into the tenant `db/tenant.ts`
names, with the preserved Firebase uids doing the per-user scoping.

## Chunks (each a PR, branch from main)

1. **`dump-format.ts` + `migrate-export.ts`** — the pure format module
   (serialization rules per spec: `__ts` tags incl. admin-SDK underscore
   Timestamps, undefined dropped, exotics/`__`-keys throw; manifest
   validation) and `exportDump()` over injected handles. Flips the two
   dump-format tests + the export sides of the round-trips.
2. **`migrate-import.ts` — data + users** — `importDump()` writing only
   through the shim write path (`DocRef.set` upsert ⇒ idempotence);
   users via `provisionUser` (uid-preserving, no password), admin claims
   via the auth-shim, `allowedEmails` seeding; `verifyDump()` for docs +
   users. Flips the data/user tests.
3. **Storage import + verify** — objects from the dump to
   `getStorage().bucket()` at verbatim paths, metadata carried; checksum
   verification. Flips the storage suite.
4. **CLI + creds-side launcher + runbook** — `npm run selfhost:import`
   / `selfhost:verify` via the `vite-node --config
   vitest.selfhost.config.ts` convention (`selfhost:api` is the model);
   `functions/scripts/export-firebase-dump.ts` as a thin launcher over
   `migrate-export.ts` using real firebase-admin (runs on a
   creds-bearing machine — Felix's or wherever Stefan says; NOT
   CI-executed). Propose a short migration runbook doc (cutover
   preconditions incl. "target starts empty", write-freeze steps) —
   propose, don't write unprompted, per practices.

## W1 carry-overs (from the #23 review — own chunk or fold into 2)

- Google/social path has zero test coverage (most likely silent
  regression on a better-auth bump; also the migration path for the
  Google-sign-in user — W3 cares).
- Mid-pickup reload strands a live server session (marker stripped
  before async pickup completes).
- Non-invited Google users fail silently — needs the selfhost
  equivalent of `submitAccessRequest` / "access requested" banner.
- Login page's GitHub button is a dead control under selfhost (needs a
  `FIBUKI_BACKEND` gate in the shared UI).
- Deferred LOWs from #21: `selfhostAuth()` promise-memo poisons on
  transient boot failure; `listUsers` omits `pageToken`.

## Guardrails

- Compose CI shares one Postgres + MinIO across suites: keep every
  fixture per-run unique (the spec suites model this; don't loosen it).
- The importer must never bypass the shim write path (no direct SQL) —
  the pushdown-queryability test exists to catch exactly that.
- `verifyDump` proves dump ⊆ target with matching content; emptiness of
  the target is a runbook precondition, not an importer invariant.
- Host safety: scoped test runs only
  (`npx vitest run <file> --pool=forks --maxWorkers=1`), scoped
  typecheck with `--ignoreConfig` + capped heap.

## Non-goals

- The cutover itself (W4 — blocked on Felix, back 2026-07-26: hosting
  target decision).
- Electric / pg-boss (Phase 3), per-user tenants, any shim teardown
  (W5/W6).
- Running the exporter against real production Firebase — that happens
  in the W4 runbook, by a human, on a creds-bearing machine.
