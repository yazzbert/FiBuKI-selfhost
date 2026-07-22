# W3 chunk 2 — migrate-import.ts (data + users)

**Suggested model: the premium/reasoning tier (e.g. Opus), not the default
mid tier.** Per `docs/claude-practices.md` "model routing," this is
genuinely multi-step, interdependent work (write-path parity, idempotence,
uid-preserving user provisioning, a verification gate) touching real
migration logic for production accounting data — not a mechanical change.
Chunk 1 (this same shape of work, smaller) needed an adversarial-review
pass on the mid tier to catch two real correctness gaps before merge; a
stronger model on the first pass should catch more of that upfront and
save a review round-trip. Stefan's call, not a hard requirement.

**Goal:** implement `functions/src/selfhost/migrate-import.ts`. Done when
all 8 `it.fails` marks in the "W3 importer acceptance" describe block of
`migrate-import.test.ts` come off and the suite is green (PGlite + compose
Postgres). The 2 "W3 dump format" tests in the same file already pass
(chunk 1, PR #26, merged). Storage import/verify is chunk 3 — out of scope
here; `migrate-import-storage.test.ts` stays fully xfail.

## Read first

- `functions/src/selfhost/migrate-import.test.ts` — the full seam is
  documented in its header comment and the "W3 importer acceptance"
  describe block (8 tests: seam-exposure, dry-run, bridge-collection
  import, flattened-collection import, user provisioning, idempotence,
  verify-gate, round-trip).
- `functions/src/selfhost/dump-format.ts` + `migrate-export.ts` (chunk 1,
  merged) — the dump contract and the writer side. `migrate-import.ts`
  reads what these write.
- `functions/src/selfhost/wire-values.ts` — `decodeWire(value, false)`
  turns `{ __ts: [s,n] }` back into a real shim `Timestamp` instance
  (same tagged encoding `dump-format.ts` speaks). Use this to decode each
  `DocLine.data` before writing — don't hand-roll a second decoder.
- `functions/src/selfhost/better-auth.ts` — `provisionUser` (around
  line 550). **Important**: it does NOT pre-check for an existing
  uid/email — it calls `ctx.internalAdapter.createUser(...)` directly, so
  a second call with the same uid will hit a DB-level conflict rather
  than returning cleanly. For the idempotence test to pass (second
  `importDump` run reports the uid under `existing`, not `provisioned`,
  and doesn't throw), `importDump` must check `getAuth().getUser(uid)`
  (auth-shim, throws `auth/user-not-found` if absent) BEFORE calling
  `provisionUser`, and branch on that.
- `functions/src/selfhost/auth-shim.ts` — `getAuth()` surface used above.
- `functions/src/selfhost/firestore-shim.ts` — `DocRef.set()` is already
  upsert semantics (always overwrites, no separate create/update split),
  so writing collection docs through the ordinary `getFirestore()
  .collection(path).doc(id).set(data)` path is naturally idempotent —
  no dedup logic needed there, just id-preserving writes.

## Design constraints (from the spec + chunk 1 lessons)

- **Writes must go through the same path the app uses** —
  `getFirestore().collection(path).doc(id).set(decodedData)` — never raw
  SQL. This is what makes flattened collections' generated/pushdown
  columns populate correctly; the "imports flattened collections through
  the shared write path (pushdown-queryable)" test is the trip-wire —
  it does a `where()` + `orderBy()` query that only works if the columns
  were populated by the real write path.
- **Invite-only gate**: when provisioning a user without `admin: true`,
  `importDump` must also seed `allowedEmails` (`await getFirestore()
  .collection("allowedEmails").add({ email, createdAt: new Date() })`)
  so the migrated user's later social sign-in isn't rejected by the
  `user.create` hook on the new stack — this is asserted directly in the
  "provisions users..." test.
- **Passwordless**: call `provisionUser({ uid, email, displayName, admin
  })` with no `password` — per W2-collapsed-into-W3, migrated users get a
  forced reset, never a working credential. The test asserts
  `signInEmail` rejects any password for a migrated user.
- **dryRun**: must touch nothing — no doc writes, no user provisioning —
  while still returning the full planned report (doc counts per
  collection, which uids would be provisioned/existing).
- **verifyDump**: per-doc deep-equal against what's in the dump (decode
  the dump's `__ts` tags the same way as import, then compare), per-user
  presence check, and it must NOT assert the target contains *only* the
  dump's docs — compose CI shares one Postgres across suites/runs, so
  extra unrelated docs in the same tenant are expected and fine.

## Guardrails

- Host safety: scoped test runs only —
  `npx vitest run --config vitest.selfhost.config.ts
  src/selfhost/migrate-import.test.ts --pool=forks --maxWorkers=1`
  (default vitest config excludes `src/selfhost/**`, must use
  `vitest.selfhost.config.ts` explicitly). Scoped typecheck: `NODE_OPTIONS
  ="--max-old-space-size=900" npx tsc --noEmit --ignoreConfig --strict
  --target ES2020 --module commonjs --esModuleInterop --skipLibCheck
  --types node <explicit files>` (project tsconfig can't be loaded
  alongside explicit files without `--ignoreConfig`).
- Compose CI shares one Postgres + MinIO across suites: every fixture
  (uid, email, collection name, doc id) must stay unique per run — the
  spec suite already does this via its `RUN`/`uniqueUid`/`uniqueEmail`
  helpers; match that pattern in any new test code.
- Before merging: adversarial self-review of the diff (same as chunk 1) —
  this repo's practice for W1/W3 chunk 1 was CI-green *and* reviewed, not
  CI-green alone.
- Branch from `main`, small conventional commits, squash-merge-shaped PR.

## Non-goals

- Storage import/verify (chunk 3 — `migrate-import-storage.test.ts`).
- CLI + creds-side launcher + runbook (chunk 4).
- The real cutover (W4 — blocked on Felix, back 2026-07-26).

Delete this file once chunk 2 is merged and either write the chunk 3
handoff or fold it into a follow-up.
