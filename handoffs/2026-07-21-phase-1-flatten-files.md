# Phase 1, next chunk: flatten `files` (then `partners`)

**Status:** `transactions` flattened and merged 2026-07-21 (PR #15, merge
`4eb3a0fa`) — second collection through the recipe, all suites green
(selfhost 257, parity both halves in CI, default 706). Scope + order
confirmed by Stefan 2026-07-20 (see `docs/decisions.md`).

## Goal

Move `files` out of the JSONB `docs` bridge into a real table behind the
unchanged shim, same recipe. Then `partners`. After files lands: write the
separate handoff for deleting matching-engine code that Postgres joins make
redundant (transactions + files are the join pair).

## Read first

- `docs/rewrite-goals.md` §Phase 1 (progress notes are current)
- `functions/src/selfhost/db/collections.ts` — the whole recipe lives in its
  header comments; the `transactions` entry is the freshest worked example
- `functions/src/selfhost/db/pushdown.test.ts` — differential suite; the
  transactions describe-block shows the fixture pattern for a new collection

## The recipe (proven on sources + transactions)

1. Inventory the query surface: `grep -rn 'collection("files")' src
   --include="*.ts" -A6` (~125 call sites) and resolve every
   where()/orderBy() field AT its call site — the wide grep window bleeds
   into neighboring queries on other collections, so verify each ambiguous
   field individually (this mattered for transactions: five fields that
   looked transaction-ish belonged elsewhere). Only queried fields become
   generated columns. Known from the transactions pass: files queries use
   `partnerId` + `partnerMatchedBy` + `extractionComplete`
   (matching/onPartnerUpdate.ts), `createdAt` >= (digest/emails),
   `__name__ in` batches, `uploadedAt` orderBy (tools/handlers.ts:335).
   Watch for array-contains on tags/categories — transactions had none, but
   check; array-contains stays JS-side either way (superset contract).
2. Add the spec to `FLATTENED` in `db/collections.ts` + a `flatTable` line
   in `db/schema.ts`.
3. `npm run db:generate -- --name flatten_files` → `drizzle/0002_*.sql`.
4. Hand-append the RLS block (ENABLE + FORCE + tenant_isolation policy) AND
   the `fibuki_app` GRANT — copy the tail of `drizzle/0001_*.sql`.
5. Migration runner backfills docs→table automatically (idempotent; exact
   `collection_path` match keeps subcollections in `docs`).
6. Extend `db/pushdown.test.ts` with a files-shaped differential block ONLY
   for ops/shapes the sources + transactions blocks don't already pin.
   Fixture rule: keep wrong-typed values OFF fields used in ordered-limit
   assertions (mixed-type under pushed LIMIT is the documented accepted
   divergence).

## Watch out

- `file.transactionSuggestions` is written by `matchFileTransactions` —
  payload data, not a query field; don't flatten it speculatively.
- Characterization suites pin real bugs on purpose (billing-cycle 12→14,
  /g-regex IBAN, suffix-strip). Port, never regenerate; never "fix" pinned
  values without Stefan.
- Suites that must stay green through EVERY collection: selfhost 257,
  parity both halves (emulator half is CI-only — no firebase CLI on this
  box), default 706, scoped typecheck.

## Non-goals

- No Better Auth / shim removal (Phase 2), no Electric/pg-boss (Phase 3).
- No schema-per-tenant, no if(selfHosted) branches — rewrite-goals rules.
- Matching-engine deletions: NOT in this chunk; separate handoff after
  files merges.

## Host guardrails (audit box)

6 GiB host. vitest needs a worker cap and then even full-config runs are
fine: `npx vitest run [--config vitest.selfhost.config.ts] --pool=forks
--maxWorkers=1` (selfhost ~37 s, default ~8 s). Scoped typecheck:
`NODE_OPTIONS=--max-old-space-size=900 npx -y -p typescript tsc --noEmit
--skipLibCheck --ignoreConfig <files>`. The guard hook matches command
TEXT — keep "tsc"/"vitest" out of commit messages and PR bodies; use
`git commit -F <file>` and `gh pr create --body-file <file>`. Push yourself
(`git push fork <branch>`); merge only on Stefan's explicit OK. Docs-only
changes go straight to main, no PR (`docs/decisions.md` 2026-07-21).
