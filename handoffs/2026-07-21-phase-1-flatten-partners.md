# Phase 1, next chunk: flatten `partners` (last collection)

**Status:** `files` flattened and merged 2026-07-21 (PR #16, merge
`50ad9e56`) — third collection through the recipe, all suites green
(selfhost 262, parity both halves in CI, default 706). `partners` is the
last flatten; scope + order confirmed by Stefan 2026-07-20
(`docs/decisions.md`). The matching-engine deletion workstream has its own
handoff (`2026-07-21-matching-engine-deletions.md`) and can run after this
or in parallel by a separate session — don't mix the two in one PR.

## Goal

Move `partners` out of the JSONB `docs` bridge into a real table behind the
unchanged shim, same recipe.

## Read first

- `docs/rewrite-goals.md` §Phase 1 (progress notes are current)
- `functions/src/selfhost/db/collections.ts` — the whole recipe lives in its
  header comments; the `files` entry is the freshest worked example
- `functions/src/selfhost/db/pushdown.test.ts` — differential suite; extend
  ONLY for ops/shapes sources + transactions + files don't already pin

## The recipe (proven on sources + transactions + files)

1. Inventory the query surface: `grep -rn 'collection("partners")' src
   --include="*.ts" -A8` (~93 call sites) and resolve every
   where()/orderBy() field AT its call site. The wide window bleeds — the
   files pass caught a `fileConnections` query masquerading as a files
   field, and partners sites sit next to `globalPartners` queries
   (partnerMatchingShared.ts, aggregateGlobalInsights.ts — verify which
   collection each chain starts on). ALSO grep for constant aliases:
   `receiveEmail.ts` hides files behind `FILES_COLLECTION`;
   `utils/globalPartnerUpsert.ts` has a constant-based collection ref —
   check whether it touches `partners` or only `globalPartners`.
   Known from this pre-scan (verify each): `userId`, `isActive`,
   `globalPartnerId`, `name` orderBy asc (tools/handlers.ts), `__name__`
   ==/in batches (no column needed). Check for array-contains on
   nameVariants/aliases-style fields — files/transactions had none, but
   partners is the likeliest holder of array fields; array-contains stays
   JS-side either way (superset contract).
2. Add the spec to `FLATTENED` in `db/collections.ts` + a `flatTable` line
   in `db/schema.ts`.
3. `npm run db:generate -- --name flatten_partners` → `drizzle/0003_*.sql`.
4. Hand-append the RLS block (ENABLE + FORCE + tenant_isolation policy) AND
   the `fibuki_app` GRANT — copy the tail of `drizzle/0002_*.sql`.
5. Migration runner backfills docs→table automatically (idempotent; exact
   `collection_path` match keeps subcollections in `docs`).
6. Extend `db/pushdown.test.ts` only for unpinned shapes. Likely candidates:
   text orderBy asc + eq filters + limit is ALREADY pinned (sources);
   `name` asc over umlaut-ish values is pinned by the s08 "Ätsch" fixture.
   Partners may genuinely add nothing new — an empty extension is a valid
   outcome; don't invent shapes. Fixture rule: keep wrong-typed values OFF
   fields used in ordered-limit assertions.

## Watch out

- Characterization suites pin real bugs on purpose (billing-cycle 12→14,
  /g-regex IBAN, suffix-strip). Port, never regenerate; never "fix" pinned
  values without Stefan.
- Suites that must stay green through EVERY collection: selfhost 262,
  parity both halves (emulator half is CI-only — no firebase CLI on this
  box), default 706, scoped typecheck.
- `globalPartners` is a DIFFERENT collection and is NOT in scope — only
  `partners` flattens in this chunk.

## Non-goals

- No Better Auth / shim removal (Phase 2), no Electric/pg-boss (Phase 3).
- No schema-per-tenant, no if(selfHosted) branches — rewrite-goals rules.
- Matching-engine deletions: separate handoff/workstream.

## Host guardrails (audit box)

6 GiB host. The test runner needs a worker cap and then even full-config
runs are fine: `npx vitest run [--config vitest.selfhost.config.ts]
--pool=forks --maxWorkers=1` (selfhost ~37 s, default ~8 s). Scoped
typecheck: `NODE_OPTIONS=--max-old-space-size=900 npx -y -p typescript tsc
--noEmit --skipLibCheck --ignoreConfig <files>`. The guard hook matches
command TEXT — keep "tsc"/"vitest" out of commit messages, PR bodies, and
even grep patterns; use `git commit -F <file>` and `gh pr create
--body-file <file>`. node/npm may be missing from PATH — the VS Code
server's bundled node is symlinked at `~/.local/bin/node` (v24); prefix
commands with `export PATH=~/.local/bin:$PATH` and use
`functions/node_modules/.bin/*` directly if npx is absent. Push yourself
(`git push fork <branch>`); merge only on Stefan's explicit OK. Docs-only
changes go straight to main, no PR (`docs/decisions.md` 2026-07-21).
