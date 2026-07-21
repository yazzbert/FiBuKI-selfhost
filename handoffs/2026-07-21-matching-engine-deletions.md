# Phase 1 workstream: delete matching-engine code Postgres joins make redundant

**Status:** investigation session DONE 2026-07-21 — inventory + per-case
proposal delivered in `docs/matching-engine-postgres-deletions.md`, awaiting
Stefan's per-case decisions (log them in `docs/decisions.md`). Next session:
whichever case Stefan OKs (likely the `fileConnections` flatten PR). The
original brief follows unchanged.

Originally: unblocked as of 2026-07-21 — `transactions` (PR #15) and
`files` (PR #16) are both real tables, so the join pair exists. Decided by
Stefan 2026-07-20 as a separate, later workstream with its own handoff
(`docs/decisions.md`). This is an INVESTIGATION-FIRST chunk: the deliverable
of the first session is an inventory + proposal for Stefan, not deletions.

## Why this exists

A chunk of the matching engine exists only because Firestore cannot join.
With `files` and `transactions` as indexed Postgres tables (generated
columns: `files.partner_id`, `files.extracted_date`, `transactions.date`,
`transactions.partner_id`, …), candidate retrieval that today is
fetch-wide-then-filter-in-JS can become a query. Deleting the workaround
code is Phase-1 payoff, not refactoring for taste.

## Ground rules

- **Port, never regenerate.** Scoring/decision logic is pinned by the
  characterization suites (billing-cycle 12→14, /g-regex IBAN,
  suffix-strip — the pinned bugs stay). Only RETRIEVAL plumbing is up for
  deletion; anything that changes which candidates are scored changes
  outcomes and needs Stefan's explicit OK per case.
- The shim interface stays unchanged (Phase 2 rips it). Replacing a JS
  candidate scan with a SQL join happens BEHIND existing function
  boundaries, or waits for Phase 2 — propose per case.
- Every proposal goes to Stefan before deletion; log decisions in
  `docs/decisions.md`.

## Candidate inventory (verify each — starting points, not conclusions)

- `matching/matchFileTransactions.ts` — pre-computes
  `file.transactionSuggestions` on file writes (payload data, deliberately
  NOT a generated column). Question: does suggestion pre-computation still
  pay for itself when candidate retrieval is an indexed query, or can parts
  become on-demand?
- `matching/matchFilesForPartner.ts`, `matching/findTransactionMatches.ts`,
  `precision-search/precisionSearchQueue.ts` (candidate windows around
  `extractedDate`/amount) — fetch-then-filter candidate retrieval;
  the `.filter((f) => !f.transactionIds || …)` "unassociated" checks are
  join-shaped.
- `__name__ in` chunk loops (`matching/learnBillingCycle.ts:275`,
  `analytics/exportMatchIntelligence.ts:129`) — 30-id batch fetches that a
  single join replaces.
- Denormalization maintained by hand: `file.transactionIds` ↔
  `transaction.fileIds` ↔ the `fileConnections` collection (three
  representations of one relation, kept in sync by
  connect/disconnect/deleteSource code). The end-state relation is ONE
  table — but `fileConnections` is not yet flattened and the UI reads the
  arrays; map every reader before proposing anything.
- `matching/processOrphanedFiles.ts` — stale-scan cron; check whether its
  staleness bookkeeping (updatedAt churn) exists to compensate for missing
  queryability.

## Suggested first-session shape

1. Read `docs/rewrite-goals.md` §Phase 1 + the candidate files above.
2. Build the inventory: for each candidate, what it does, why Firestore
   forced it, what the Postgres-native shape is, what deletes vs stays,
   and which characterization tests pin it.
3. Write the proposal doc, hand to Stefan, log the decision. No code in
   the first PR unless a case is trivially retrieval-only AND Stefan OKs.

## Host guardrails (audit box)

Same as ever: 6 GiB host, worker-capped test runs only
(`--pool=forks --maxWorkers=1`), scoped typecheck via NODE_OPTIONS +
--ignoreConfig, guard hook matches command TEXT (use `git commit -F` /
`--body-file`), node may need `export PATH=~/.local/bin:$PATH`. Push
yourself (`git push fork <branch>`); merge only on Stefan's explicit OK;
docs-only commits straight to main.
