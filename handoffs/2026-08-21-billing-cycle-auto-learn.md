# Billing cycle auto-learn (#166) — handoff

Ticket: [yazzbert/FiBuKI-selfhost#166](https://github.com/yazzbert/FiBuKI-selfhost/issues/166),
second slice of the recurring-billing epic
([#164](https://github.com/yazzbert/FiBuKI-selfhost/issues/164)). Blocked by
[#165](https://github.com/yazzbert/FiBuKI-selfhost/issues/165) (PR
[#181](https://github.com/yazzbert/FiBuKI-selfhost/pull/181), not yet merged —
check it landed before starting, or branch from `feat/billing-cycle-data-model`
directly if it hasn't).

## Goal

Fibuki learns a partner's billing cycle on its own: right after a file
connects to one of that partner's transactions, and nightly for every partner
with 3+ transactions. No more manual `learnBillingCycle` call needed.

## What #165 already gives you

`functions/src/matching/billingCycle.ts` — pure, no Firestore I/O:

- `deriveLearnedCycles(transactions: BillingCycleTransaction[]): DerivedBillingCycle[]`
  — band-split interval detection. Feed it `{date, amount, invoiceDates?}` rows.
- `resolveEffectiveCycles(learned, declared?): ResolvedEffectiveCycle[]` —
  merges declared over learned. `declared` will stay empty until #167 ships
  the declare/clear MCP tool; for #166 you're just calling this with an
  empty/no declared array (or reading whatever's already on the partner doc,
  same as `learnBillingCycleCallable` does).

`functions/src/matching/learnBillingCycle.ts` is the reference caller: builds
`BillingCycleTransaction[]` from a `transactions` query filtered by
`partnerId` (never `bankPartnerId` — #166's own AC repeats this, it's not
just a #165 concern), calls the two pure functions, writes
`billingCycle.learned` / `billingCycle.effective` via a **dotted-path
`update()`** so `billingCycle.declared` is never touched. Copy this shape for
both new call sites rather than reinventing it.

## Where the two triggers go

**Post-connect**: `functions/src/matching/learningQueue.ts` is the existing
debounced post-connect learning pipeline — `queuePartnerForLearning` queues a
partner (5-minute debounce), `processLearningQueue` (an `onSchedule` export)
drains the queue and calls `learnPatternsForPartnersBatch` (file-source
pattern learning — the thing the ticket's spec text points at as "next to
where file-source patterns are learned"). Read this file first. Two open
questions to resolve, not assumed: (1) does `queuePartnerForLearning` fire
automatically from `connectFileToTransaction.ts`, or only from an explicit
client call — check `functions/src/files/connectFileToTransaction.ts`;
(2) whether billing-cycle learning belongs inside the same batch drain
(cheapest — reuses the existing debounce and partner-of-transaction lookup)
or a separate lightweight trigger. Batching into the existing drain is
probably right, since AC says "next to where file-source patterns are
learned," but confirm the batch function actually has transaction history
loaded already before assuming reuse saves a query.

**Nightly**: no existing "walk every partner nightly" job to extend — this is
new. Self-host pickup is automatic: `functions/src/selfhost/cron-host.ts`
scans the `functions/src/index.ts` barrel for any `onSchedule(...)` export
and registers it with node-cron (translates Cloud-Scheduler-style strings
like `"every 24 hours"`). So the nightly job is just a normal Firebase
`onSchedule` function, exported from `index.ts` like `processLearningQueue`
already is — no self-host-specific wiring needed. Query partners with 3+
transactions per user (AC says "for the user," so this presumably iterates
users too, not a single global collection scan — check how
`processLearningQueue` or `aggregateGlobalInsights.ts` iterate users for the
pattern already in use).

## Guardrails

- Host is 4 GiB (claude-audit LXC) — scoped `vitest`/`tsc` only, see
  `docs/claude-practices.md`. New worktree needed
  (`.claude/worktrees/wt-166`, symlink `node_modules` and
  `functions/node_modules` from the main checkout — `ln -s`, don't `npm
  install`).
- AC says nightly learn "makes no AI call — history only." It doesn't; keep
  it that way, don't reach for an LLM here.
- AC: "the worker chat and agent tools that already read `billingCycle` keep
  working unchanged" — #165 already migrated `search-tools.ts` and
  `batch-tools.ts` to read `.effective[0]`; you shouldn't need to touch them
  again unless auto-learn changes the shape those tools see (it shouldn't —
  same write path as the manual callable).
- `functions/src/selfhost/matching-characterization.test.ts` pins
  `learnBillingCycleCallable`'s exact numeric outputs (confidence formula,
  the 12-day-relabeled-as-14-day quirk, etc.) — don't touch those tests
  unless the callable's own behavior changes; the new triggers call the same
  pure functions, so nothing there should need updating.
- Scheduler-shim lets the nightly function run directly in a test — AC asks
  for this explicitly. Look at how existing `onSchedule` exports get
  exercised in tests (grep `scheduler-shim` usage) before writing a new
  pattern.

## Non-goals (still deferred)

Declared cycles (#167), band-aware matching (#168), search date windows
(#169), UI (#170), export/import (#171). Auto-learn only writes `.learned`
and `.effective` — never touches `.declared`.
