# Decision log

Audit trail of **human decisions** — the calls Stefan (or another human) makes
that shape the project but don't show up as reviewable code. GitHub is the
audit trail for code changes; this file is the audit trail for judgment calls:
scope, process, product rules, external commitments.

**Rules:**

- Every session that involves a human decision appends it here, newest first.
- One entry per decision: date, who decided, the decision, and enough context
  that a reader six months later understands *why* without spelunking chat
  logs.
- Code-level choices (naming, index tuples, refactors) stay in PR
  descriptions; product/architecture foundations live in
  [`who-is-this-for.md`](who-is-this-for.md) and
  [`rewrite-goals.md`](rewrite-goals.md) — this log records the dated calls
  that applied or changed them.
- This file is docs: it ships to `main` without a PR (see 2026-07-21 below).

---

## 2026-07-21 — Partners flatten merged; Phase 1 flattening complete

**Decided by:** Stefan (merge OK on PR #17)

Conditional OK ("if the rls.test.ts problem is fixed, merge") — the fix was
already in the reviewed, CI-green commit, so the PR merged as-is. All four
collections (`sources`, `transactions`, `files`, `partners`) are now real
tables; the JSONB `docs` bridge holds only unflattened collections and
subcollections. Next workstream per the 2026-07-20 scope decision:
matching-engine deletions (own handoff).

## 2026-07-21 — Docs changes ship without PR/review

**Decided by:** Stefan

Documentation-only changes (files under `docs/`, handoff hygiene) can be
committed and pushed straight to `main` without a pull request or review.
Code changes keep the full PR → CI → adversarial review → explicit-merge-OK
workflow.

## 2026-07-21 — Human decisions get a persistent audit trail

**Decided by:** Stefan

Human decisions must be recorded in a document under `docs/` (this file).
Rationale: GitHub covers code provenance, but the judgment calls behind the
code lived only in session transcripts and handoff files, which get deleted
once fulfilled.

## 2026-07-21 — CodeQL runs `security-extended` only

**Decided by:** Stefan (merge OK on PR #14)

Dropped the `security-and-quality` suite; kept `security-extended`. The ×166
quality-only alerts auto-closed with the suite switch. A quality-rule cleanup
round remains possible later but is deliberately untracked.

## 2026-07-21 — Keep `getServerUserIdWithFallback` name after auth fix

**Decided by:** Stefan (merge OK on PR #12)

The verify-ID-token fix kept the historical function name to avoid touching
44 API routes in a security PR. The "fallback" in the name is historical;
renaming is optional cleanup, not scheduled.

## 2026-07-20 — Phase 1 flattening scope and order

**Decided by:** Stefan

Flatten collections out of the JSONB bridge in call-site-weight order:
`transactions` → `files` → `partners` (after `sources` proved the harness).
After transactions + files land, start deleting matching-engine code that
Postgres joins make redundant — as a separate, later workstream with its own
handoff. Non-goals confirmed: no Better Auth / shim removal (Phase 2), no
Electric/pg-boss (Phase 3), no schema-per-tenant, no `if (selfHosted)`
branches.

## Earlier foundations (pre-log)

Decisions made before this log existed are recorded in their governing docs:

- Product scope — Austria-only pre-accounting for EPUs; Steuerberater is
  gatekeeper, not buyer; self-host and cloud ship the same features:
  [`who-is-this-for.md`](who-is-this-for.md).
- Rebuild rules — port never regenerate; self-host is multi-tenant with one
  tenant; the API layer owns all DB access; tests before port work:
  [`rewrite-goals.md`](rewrite-goals.md).
- Operational rules — transaction deletion not allowed, server-side scoring
  only, Cloud-Functions-only mutations: [`CLAUDE.md`](../CLAUDE.md).
