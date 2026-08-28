# The reconciliation landed. What is left is one defect and four chores.

The Self-host deployment lane is reconciled onto the trunk and deployed. The work that
was open when the previous brief was written is closed. What remains is a **correctness
defect the deploy exposed** — not one it caused — and housekeeping.

## Read first, and do not re-derive what these say

1. `handoffs/2026-08-26-post-migration-brief.md`, for how the lane came to exist. Its
   "Owed by Felix" section is stale: the trunk now continuously deploys itself onto a
   Self-host stack, so the manual-deploy framing there no longer holds.
2. **felixtosh/FiBuKI#185** — the reconciliation spec, and **#186**'s sweep comment on it.
   The sweep is the reason the carried set is 27 files rather than the 11 the first method
   found; read it before assuming any enumeration here is complete.
3. **felixtosh/FiBuKI#203** — the live defect. Read the issue **and its follow-up comment**;
   the comment both narrows and widens the original report and is the accurate version.

## Where it stands

The lane is a **descendant of the trunk** — `git merge-base --is-ancestor origin/main <lane>`
answers yes, and that property is the whole point. Full CI matrix green on the merged tip,
CodeQL included, both Self-host suites included (PGlite and real Postgres + real S3).

Deployed. The health census went **up by one callable**, and the new export is the file
panel's save function, which previously had nothing to call. Neither data volume was
recreated. Both correction paths were then exercised by hand and both work.

The scheduled forwarder that caused the divergence is retired, along with the push guard
that policed the branch it fed. The retired branch is tagged, not deleted.

**The reconciliation is finished.** Nothing below is a continuation of it.

## What is actually left

### 1. The defect, and it is the only item that touches figures

**FIXED. PR #204 merged 2026-08-28 as `a8cf0426` on Stefan's go-ahead, CI 9/9 green
(CodeQL included); #203 auto-closed, and #185 is closed with it — every child of the
epic is done.** Verified on the trunk by content, not sha (squash): the builder imports
the shared reconciler, `lineItemReconciliation.ts` exists, and the panel's dead
consolidation is gone. The fix reaches Self-host through the trunk's continuous deploy;
the Firebase cloud deploy remains Felix's, and until he runs one, Cloud users still have
the pre-fix behaviour described below. The shape:
the reconciliation flag is now derived, never asserted — `buildExtractionCorrection`
re-derives it against the corrected record, an untouched panel save re-derives against
the stored record and no longer deletes the printed rate-group block, the panel sends
only what the person typed (no more row-derived total or VAT posted as a ruling, and the
amount box is seeded from the stored total), and all four `getEffectiveExtractedAmount`
copies return the stored total for a flagged File. The pure reconciliation cluster moved
out of `extractionCore` into `functions/src/extraction/lineItemReconciliation.ts` (core
re-exports), and its candidate filter now keeps negative rows so a person completing an
itemisation with the missing discount row reconciles. Deliberate behaviour change,
stated on the PR: a File whose corrected total deliberately differs from its items (a
Schlussrechnung) now stays flagged and the UVA refuses it instead of silently deriving
from the wrong scope. Follow-ups named on the PR, not filed yet: `updateFile`'s inline
line-item consolidation (same defect shape, different callable), consolidating the four
derivation copies, and the "line sum exactly 2x" cluster as its own extraction issue.
The paragraphs below describe the PRE-FIX behaviour, kept as the record of what the
defect was — and as the operating constraint for Cloud until Felix deploys.

**felixtosh/FiBuKI#203.** Correcting any VAT-bearing field on a File clears
`extractedRateGroups` — the extracted tax table carrying the document's own totals — and
in the same block sets `lineItemsUnreconciled` to `false`. Every derived surface then
re-derives from the line items.

That is fine when extraction captured every printed row. It is not fine when it skipped
one, and the rows most often skipped are exactly a zero-value postage line and a negative
discount line, because neither looks like a purchase. The re-derived total then comes out
**higher** than the document.

The sharp part, and the reason this is not cosmetic: the UVA already has a guard that
refuses a File whose line items are flagged and whose rate groups are unusable. The
correction defeats **both halves of that guard at once** — it removes the data
`hasUsableRateGroups` tests for and clears the flag the guard tests. Before a correction
such a File is refused with `amount-mismatch`. After one it silently contributes VAT
summed from an incomplete list. The transition is triggered by a person fixing a wrong
extraction by hand.

The stored `extractedAmount` is **not** corrupted, and the UVA's gross figure reads it
raw, so totals are safe. It is the VAT derivation that is exposed.

**A sweep of one instance found two distinct populations, and telling them apart matters:**

- **Positive gap at a ratio of exactly 1.2000** — line items net, header gross. Legitimate,
  handled by the `amountsLookNet` branch. Roughly half of what the query returns. Not this
  bug, and reporting it as such will waste a triage.
- **Negative gap** — line items summing to more than the document total. This is the at-risk
  set. Within it, two shapes: gaps matching a printed discount row the extractor skipped,
  and a cluster where the line sum is **exactly twice** the stored total, which looks like a
  duplicated row or a doubled quantity and probably deserves its own issue.

Every File in that set is **correct at rest**. Each becomes wrong the moment a VAT-bearing
field on it is corrected. Until #203 is fixed, that is the operating constraint, and the
obvious workaround does not work: setting `vatAmount` explicitly will not save the File,
because line items outrank the top-level field in the derivation order.

**One File went into this state and has been brought back.** It was the File used to verify
the correction callable during the deploy. Its direction was reverted by hand; its amount
and VAT were not, and both were left carrying hand-correction markers at *wrong* values —
stamped, so a re-extraction would have refused to fix them. Resolved by clearing its line
items and setting the amount and VAT to what the document prints, which makes the
top-level fields authoritative because nothing outranks them any more. Worth knowing that
a correction made to *test* a correction is indistinguishable from a real one afterwards.

The tool's own contract states the intended behaviour plainly:

> The corrected total is NOT re-derived from the line items, so an amount that
> deliberately differs from them survives.

That is the promise. The derivation path does not keep it, which is the clearest statement
of #203 available: this is not a missing feature, it is documented behaviour that does not
hold.

### 2. Four chores, none of which touches a figure

- **homelab#137** — the deploy. Done in substance; the outcome is recorded on it. Closes
  when the grant is revoked.
- **homelab#139** — record the instance's site config in the infrastructure repo, and fix
  two documents that name a branch which has not been deployed since July.
- **homelab#140** — a thin pool at 79 percent with no autoextend threshold set. Slow-moving:
  ample headroom today, and it corrupts every volume on it at once if it ever fills.
- **homelab#141** — codify the deploy, written from what the manual run actually did rather
  than from the runbook's description of it.

**felixtosh/FiBuKI#185 is closed** (2026-08-28, alongside the #204 merge); every child
was closed and the work done.

## Verify before it is forgotten

`list_files handCorrected:true` returns **4** Files. A direct query of the store finds
**10** carrying correction markers. That tool is the exclusion list `retry_file_extraction`
consults before a re-extraction sweep, so if it under-reports, a sweep can overwrite
exactly the corrections the marker exists to protect. Not chased. It is either a filter
that tests a field the retro-stamp never wrote, or a real gap in the guard — and the
difference matters.

## Guardrails that still apply

- **The app API is the better tool, and it is already provisioned.** The instance's own
  tool surface answers `list_files`, `get_file` and `update_file_extraction` over HTTP with
  a key. It reaches things an OS-plane grant cannot, and it is the correct plane for
  reading or correcting records. Do not reach for an OS grant to inspect data.
- **The OS grant cannot take a backup.** `docker run --rm` is deliberately dropped from the
  profile, compose `exec` is not granted, and the profile pins bare container names while
  compose prefixes them with the project. `backup.sh` needs all three. A snapshot at the
  hypervisor is the right rollback for a deploy anyway — it captures both data volumes
  atomically and restores in one action.
- **`sudo git` on the checkout fails with dubious ownership**, because the checkout is
  service-owned and sudo runs as root, so git compares against `SUDO_UID`. Git's own
  prescribed fix works through the granted command form.
- **Client-side build values are build arguments.** The web image must be rebuilt, never
  restarted, or it ships the previous values while appearing to update.
- **Host safety.** No full test suite, no project-wide typecheck, no production build on the
  small box. Scoped and single-worker only.
- **This checkout is shared and its branch moves under you.** Commit from a detached
  worktree, push, remove it. Never stash here.
- **Both repos are public.** Scrub amounts, partner names, hostnames and filing figures from
  anything posted — including issue bodies and this file.

## Lessons worth more than the tickets

**A branch fed from *unlanded* topic branches will always diverge.** The forwarder merged
every open `feat/*` daily, so the lane absorbed the pre-review draft of each feature while
the trunk later took the reviewed version. Two lineages of the same work that git cannot
recognise as related — 76 conflicted files. Replaying the genuinely-unique changes onto a
branch cut from the trunk was 11 files and zero conflicts. **Replay, do not merge**, when
the divergence is drafts-versus-reviewed rather than genuine parallel work.

**A failing merge job must report the size of what it could not merge.** The forwarder's
last run named two conflicting paths. The real number was 76. Two reads as a bad afternoon;
76 reads as a different strategy.

**Check the field before writing the ticket.** One ticket here was filed on a misreading of
an older issue's wording, describing a correction to a field that does not encode what the
wording meant. It was closed unimplemented after the type was checked. Reading
`type InvoiceDirection` first would have cost seconds.

**A `WHERE` clause is not evaluated in written order.** A type guard beside the call it
guards does not protect it; Postgres may run either first. Put the guard in a `CASE`, which
does promise order, and filter outside a materialised CTE so the planner cannot push the
predicate back down.
