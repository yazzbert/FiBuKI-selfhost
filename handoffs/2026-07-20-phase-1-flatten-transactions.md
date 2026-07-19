# Phase 1, next chunk: flatten `transactions` (then `files`, `partners`)

**Status:** Phase 1 foundation landed as `9152fc67` on `phase-1-schema`
(Drizzle migrations, tenant_id + RLS via `fibuki_app` role, SQL pushdown,
`sources` flattened). Scope + order confirmed by Stefan 2026-07-20.
Precondition: the phase-0/phase-1 PRs should be open so CI exists — the
compose job is the ONLY coverage of the node-postgres Pool path (no docker
on the audit box).

## Goal

Move `transactions` out of the JSONB `docs` bridge into a real table behind
the unchanged shim, same as `sources`. Then `files`, then `partners`.
After transactions + files: start deleting matching-engine code that
Postgres joins make redundant (separate handoff when we get there).

## Read first

- `docs/rewrite-goals.md` §Phase 1 (progress notes are current)
- `functions/src/selfhost/db/collections.ts` — the whole recipe lives in its
  header comments
- `functions/src/selfhost/db/pushdown.test.ts` header — what the
  differential suite pins and the one accepted divergence (mixed-type
  fields under pushed LIMIT)

## The recipe (proven on sources)

1. Inventory the query surface: `grep -rn 'collection("transactions")' src
   --include="*.ts" -A3` and collect every where()/orderBy() field
   (~175 call sites — expect userId, sourceId, date, amount-ish fields;
   derive from the grep, don't guess). Only queried fields become
   generated columns.
2. Add the spec to `FLATTENED` in `db/collections.ts` + a `flatTable` line
   in `db/schema.ts`.
3. `npm run db:generate -- --name flatten_transactions` → new SQL file in
   `functions/drizzle/`.
4. Hand-append the RLS block (ENABLE + FORCE + tenant_isolation policy) AND
   add the table to the `fibuki_app` GRANT — copy the pattern from
   `drizzle/0000_init.sql`. drizzle-kit does not author RLS/grants.
5. The migration runner backfills docs→table automatically (idempotent).
6. Extend `db/pushdown.test.ts` with a transactions-shaped differential
   fixture ONLY if the collection uses ops sources didn't (check
   array-contains on categories/tags, `in` chunking at 30, the
   `tools/handlers.ts:228` startAfter+orderBy shape — verify that exact
   shape compiles with LIMIT pushed).

## Watch out

- `transactions/{id}/history` subcollection stays in `docs` — routing
  already handles it (`rls.test.ts` pins the sources analog); make sure
  recursiveDelete of a transaction still catches its history.
- Timestamps: `date` fields make transactions the first heavy user of the
  timestamp generated column + keyset cursors. The generated-column
  expression is type-guarded; equal-timestamp rows fall to the id tiebreak.
- The characterization suites pin real bugs on purpose (billing-cycle
  12→14, /g-regex IBAN, suffix-strip). Port, never regenerate; never "fix"
  pinned values without Stefan.
- Suites that must stay green through EVERY collection: selfhost 247,
  parity 128 both halves (emulator command is in the parity test header),
  default 705, tsc.

## Non-goals

- No Better Auth / shim removal (Phase 2), no Electric/pg-boss (Phase 3).
- No schema-per-tenant, no if(selfHosted) branches, no cloud-gated
  capability — rewrite-goals rules.
- Don't extend the sources spec speculatively; queried fields only.

## Host guardrails (audit box)

6 GiB: vitest always `--pool=forks --maxWorkers=1`, tsc via
`NODE_OPTIONS="--max-old-space-size=900"`, no parallel sub-agents, PATH
needs ~/.local/node/bin + ~/.local/java/…/bin. `git push` is
classifier-blocked — Stefan pushes.
