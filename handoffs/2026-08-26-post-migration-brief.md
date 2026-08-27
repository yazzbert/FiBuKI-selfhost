# After the migration: the walkthrough, and the three things still moving

Supersedes `2026-08-26-post-wave-6-brief.md`, which is fulfilled and removed. Everything that
brief asked for is done: wave 6 confirmed merged, the report for Felix written, the fork's issues
migrated.

## Read first, and do not re-derive what these say

1. Memory: `project_fibuki_selfhost` — the **2026-08-26 "the report for Felix, and the fork's
   issues MIGRATED" section first**, it supersedes every earlier same-day section. Then
   `feedback_migrating_a_ticket_is_a_re_evaluation`,
   `feedback_frontend_autodeploys_functions_do_not`,
   `feedback_concurrent_sessions_on_audit_lxc` (its 2026-08-26 paragraph is about *this* repo),
   `reference_fibuki_landing_report`, `index-webdev.md`.
2. **The report for Felix**: `syh-company/projects/fibuki-development/reports/
   2026-08-26-report-for-felix.html`, published as artifact `b3bf6a46`. **The HTML is the
   document** — the `.md` beside it is an earlier draft covering #109–#153 only, kept for the
   diff. It now covers #109–#181 and it is what the walkthrough runs on. Do not send him the
   living landing report instead — different audience. Its design is a checked-in house format:
   `BRIEFING-FORMAT.md` + `_briefing-template.html` in that folder, and any future brief for
   Felix starts from those rather than a redesign. Edit the repo copy and republish to the same
   artifact URL; never draft one in a scratchpad.
3. The mapping comment on **felixtosh/FiBuKI#98**, and this repo's
   `handoffs/2026-08-26-issue-migration-plan.md` (kept as the record of how the triage was made).
4. The living report + `STATUS.md` in `syh-company/projects/fibuki-development/`. Update the
   changelog and cards as you work; syh-company push gates apply (`check-data.py`,
   `check-append-only.sh`, `markdownlint-cli2@0.22.1` on `**/*.md`).

## Where it stands

All six landing waves are on `felixtosh/FiBuKI` `main` — 26 PRs, #109 through #153. **Plus
#90**, Felix's own PR, open since 24 August and merged the same evening as `a726f5b8`: the
self-host shim matched `FieldValue` sentinels by `constructor.name`, which the Next production
bundler mangles, so every sentinel written from an app route stored as `{}` and one such row
crashed every page on sign-in. That is the upstream landing of **fork #52** — close it in the
migration rather than copying it, and note the near-miss: it looked already-landed only because
the local checkout tracks the FORK's `main`, not `origin/main`. The fork is
drained of code and now of issues: **0 open** as of 2026-08-26 night, #232 being the last to close. Upstream carries 40 open issues, of which
#155–#171 arrived in the migration.

**#89 is closed.** Felix carries the Austrian module as a full feature; only its *presentation*
(plain / opt-in / Austria-first) is open, and that is a walkthrough question, not a ticket.

**#98 is deliberately open.** The migration half is done; archiving the fork waits on #99.

## What is actually left

**Nothing here is blocking, and none of it is a lane.** Three things are moving, none of them
ours to force:

1. **The walkthrough with Felix.** He reviews all six waves with Stefan before any deploy. Put
   the standing questions on that agenda — they have been carried since #85 and belong to him:
   one shared pagination helper instead of three call sites, and how the Austrian module is
   presented.
   - The pagination one is **settled in PR #175**: measured, only the cursor decode was common,
     and the reason to extract it is that it carries the ownership check — the two `nextCursor`
     rules stay separate. Felix can still disagree, but the question now has an answer to react
     to.
   - The **Paperless-anchor question is answered, with one gap found 2026-08-27** (see
     `2026-08-27-issue-189-outcome.md` and #198): the guard's FiBu pattern is built as
     `["FIBU", "\\d{8}"].join("_")`, so the separator is hard-coded to an underscore and a
     reference written with a **space** passes clean. One is on `main` right now, in
     `functions/src/uva/nonClaimableVat.test.ts:63`. The fixtures below were genuinely
     fixed; the guard that is supposed to keep them fixed is not airtight, and the guard is
     what people act on. PR #176 replaced every `paperless-ap-NNNN`,
     own `IV-YY-NNNN`, `FIBU_YYYYMMDD-NNNN`, the private research path and a named restaurant
     with descriptive fixture ids, and `scripts/check-corpus-anchors.js` now fails CI before
     `npm ci` if one comes back. Fixture prose describes documents instead of citing them.
   - **PR #79 is off the list entirely.** Stefan closed it himself, by mistake, and its work
     landed anyway through #115/#116. It was on the agenda as "why was it closed without a
     comment" — do not raise it with Felix, and it is gone from the report for him.

2. **That cluster is closed.** Updated 2026-08-26, night:
   - **#229 and #233 are DONE** — upstream PR #178, 9/9 green, merged; both fork issues closed
     by hand afterwards (a cross-repo `Closes` links but never closes — see
     [[reference_github_crossrepo_closes]]). The § 11 classifier now stores whether the named
     recipient IS the user and blocks a third party's VAT from the UVA; `invoiceDirection` has
     a review flag, a `list_files` filter, an editor on both paths, and an unplaced amount no
     longer renders as green income.
   - **#116 is merged** — PR #175, and with it the shared-pagination-helper answer below.
   - **#232 is DONE** — upstream PR **#180**, merged `f6805e69`; the fork issue closed by hand.
     Identity names are normalised and compared as token sets instead of substrings, so middle
     names, punctuation and word order stop missing, and the U+2018 apostrophe case resolves
     without an alias. The three drifted copies of that comparison collapsed into
     `functions/src/utils/identity-matcher.ts` (−529/+145 across the two callers), which #229's
     `recipientIdentityMatch` also rides on: `hasIdentitySignals` now sees every identity entity
     in the extraction path, where it previously got three flattened fields.
     **This one does not need a NEW function deployed** — the matcher compiles into six triggers
     and callables that already exist in production, so the symptom until the redeploy is simply
     that nothing changes. And the 81 files that sat at `unknown` do not re-evaluate on their
     own: a touch to `settings/userData` fires `onUserDataUpdate` and sweeps them (capped at
     `MAX_FILES_PER_UPDATE = 500`), or re-extract.
     The trade-off, stated on the PR: order-independent subset matching means `Stefan Herbert`
     now also matches an unrelated `Herbert Stefan Immobilien GmbH`. It only bites where the name
     is the sole signal, against 27 percent of documents previously carrying no direction at all.
     **The port is the lesson** — the fix was built on a fork branch and could NOT be PR'd from
     there: upstream carried #229's `recipientIdentityMatch` and a whole `recipientIdentity.ts`
     that the fork trunk has never had, so a cherry-pick would have applied cleanly and deleted
     a shipped feature. It was replayed on `bundle/identity-name-matching` cut off `origin/main`.
     See [[feedback_upstream_pr_needs_a_bundle_branch]].
   - **#149 is DONE** — upstream PR **#179**, merged.
     The panel's save moved behind an `updateFileExtractedFields` callable that routes through
     the same builder the MCP tool uses, so a correction typed by a person leaves provenance and
     re-extraction refuses it. Its brief is fulfilled and removed. Two things came out of it that
     are not in the PR:
     - **The deploy list grows.** The callable does not exist until
       `firebase deploy --only functions`, and until then the panel's save fails outright — this
       is not a "field reads undefined" case, it is a missing function. Add it to what is owed
       below.
     - **A follow-up nobody has taken.** `updateFile` (from #178) still does the
       classification / direction-review / provenance sequence inline for `invoiceDirection`,
       which is now the third copy of it. `buildCorrectedFileUpdate` is where that lives for the
       other two surfaces. Flagged on PR #179 as a comment; open it as an issue if it survives
       the walkthrough.
3. **#99, then the archive.** Repointing `fibuki.home.syh.at` at the merged `main` is parked until
   Stefan's taxes are filed. When it moves: dump first, repoint, then **archive the fork — never
   delete it** — and close #98.

## Verify before it is forgotten

**CodeQL alert closure for PR #177 — DONE, verified 2026-08-26 18:00 UTC.** #285 and #296 both
read `state=fixed` on `refs/heads/main` after the trunk was re-analysed, and the open count for
`js/remote-property-injection` went **8 → 6**. Nothing left to check here.

The method matters more than the result, because two earlier PRs merged claiming this fix and did
not deliver it:

- A **green PR CodeQL check proves only that no NEW alert appeared** relative to the base. It says
  nothing about whether an existing alert still fires. #90 and #173 both went green while leaving
  #285/#296 open.
- The **merge-ref instance is not proof either**: #285 read `fixed` on `refs/pull/90/merge` and
  came back **open** on `main` after that PR merged. Newer PR analyses are diff-informed, so the
  instance may not exist at all — and an empty result looks identical to a clean one.
- The only proof is the alert's state on `refs/heads/main` after the merge:
  `gh api /repos/felixtosh/FiBuKI/code-scanning/alerts/<n> --jq '.state'`

Why the `Map` worked where `Object.create(null)` did not: the rule anchors on the **write
statement** with an attacker-influenced key. Changing what it writes *into* leaves the statement
there, so the alert just moves down the file. Deleting the statement closes it. Full method in
memory as `reference_codeql_alert_verification`.

**Upstream #174 is closed too, and the rule is now at zero open on `main`.** PR #181 merged as
`d727d3de`; the analysis of that head reports all six of #279–#284 `fixed`, and the trunk's
`results_count` went **20 → 14** — exactly the six, nothing else moved. The issue auto-closed on
merge.

One prediction in the earlier version of this section was wrong, and the correction is the useful
part. #282/#283/#284 were mechanical with a `Map`, as expected (`customMetadata` in
`storage-routes.ts` does reach the storage SDK, so it is rebuilt into a plain object with
`Object.fromEntries` before it leaves the block). But **#279/#280/#281 did not need the written
dismissal this brief expected.** `deepSet`/`deepDelete` walk into an *existing* decoded document,
so there is no accumulator to replace — the fix is to stop mutating in place: rebuild each level
on the way out (`new Map(Object.entries(node))` → `Object.fromEntries`), return the new document,
reassign in `applyUpdate`. That deletes the write statement *and* the `delete` statement, and all
three closed, #281 included. **Reach for restructuring before dismissing.**

Two behaviour changes shipped with it, both deliberate and both tested in the new
`functions/src/selfhost/dot-path-update.test.ts`: writing *through* a Timestamp now replaces it
with a map (the old walk wrote a stray property onto the Timestamp instance, which `encodeValue`
then dropped — the update silently did nothing), and deleting an array element by index
(`"tags.0"`) is now a no-op instead of leaving a hole that stored as `[null, "b"]`.

Two operational notes for the next person doing this. The alert state only flips **after** the
push-triggered analysis of the new trunk head finishes, about three minutes here — reading
straight after clicking merge returns `open` for a fix that works. And a squash merge gives the
trunk a new sha, so `git merge-base --is-ancestor <local-sha> origin/main` says **NO** even when
the change landed; verify by content, `git show origin/main:<path>`.

**Nothing to deploy for this one.** All six sites are `functions/src/selfhost/**`, which runs in
the self-host container, not on Firebase — it is not on Felix's `firebase deploy` list. And the
running instance tracks the fork's `stefan-prod`, so the fix reaches `fibuki.home.syh.at` when the
repoint in item 3 happens, not before.

## Owed by Felix, unchanged

`firebase deploy --only functions`. It carries `updateFileExtractedFields` (PR #179 — without it the
file panel's save has no function to call), the identity-matching fix from PR #180 (no new function,
but `extractFileData`, `extractFileDataOnUndelete`, `retryFileExtraction`, `bulkRetryExtraction`,
`onUserDataUpdate` and `onUserDataCreated` all compile it in, and it does nothing until they are
redeployed), `retryFileExtraction` **with** its authentication
and ownership check (the deployed version has neither, so any caller can spend another account's
extraction budget and reset its matching), `calculateUva` (the UVA page calls a function that does
not exist), `prepareUvaFiling`, `scheduledRefreshEcbRates` (until it runs once, no foreign-currency
amount shows a converted figure anywhere), the billing callables, the § 11 sync triggers, and
`reclassify_documents`, which is in the MCP catalog and errors when called.

Then `firebase deploy --only firestore:rules` for the `uvaFilings` (+ `snapshots`) and
`fxReferenceRates` blocks — hygiene, both Admin-SDK-written and never client-read.

The one-function split `firebase deploy --only functions:retryFileExtraction` is stated in the
report, section 3. **That argument has been made; do not make it again.** Stefan's call was to
offer it there and leave the deploy to Felix.

## Non-goals

- Do not open lanes against the held issues, or against #116/#149 — both are landed.
- Do not touch #99 or the fork archive.
- Do not deploy anything to the live Firebase project, and ask Stefan before touching it at all.
- Do not re-litigate #89. It is decided.

## Guardrails that still apply

- **Host safety.** Never a full `vitest`, a project-wide `tsc`, or a full Next.js production build
  on this box — the guard hook blocks those shapes and the box OOMs. Scoped only:
  `npx vitest run <one-file> --pool=forks --maxWorkers=1`. Self-host tests from `functions/` with
  `--config vitest.selfhost.config.ts`; app-route and repo-root `lib/` tests with
  `--config vitest.api-smoke.config.ts`. **No parallel sub-agents here** — review inline and say
  so in the PR. The guard hook matches the command *string*, so write such files with the editor
  tool rather than a heredoc.
- **This checkout is shared and its branch moves under you.** A concurrent session had it on its
  own lane branch with uncommitted work mid-session. For any commit, use
  `git worktree add --detach <tmp> fork/main`, commit there, `git push fork HEAD:main`, then
  `git worktree remove`. Never `git stash -u` in the `~/Projects/Fibuki Self-Host/` worktrees; it
  eats the node_modules symlinks.
- **`origin` is the public upstream, `fork` is ours.** Handoffs and working notes go to
  `fork/main` only. `handoffs/` also exists on upstream from July, so its presence there proves
  nothing.
- **Push and PR-create upstream need the classic token in the URL**:
  `git push https://x-access-token:$GH_CLASSIC_TOKEN@github.com/felixtosh/FiBuKI.git b:b` and
  `GH_TOKEN=$GH_CLASSIC_TOKEN gh pr create`. A bare push after sourcing the env file 403s.
- **CI**: `ci.yml` fires only on `base=main`, so a stacked PR needs a draft carrier from the chain
  tip; close the carrier *before* retargeting the tip or the retarget 422s. Guard the poll on the
  check **count** as well as the conclusion — an empty check list reads as all-green in the
  obvious jq one-liner.
- **Gates.** Felix waived per-PR review until map #93 is done — standing, not per-day. Stefan's
  say-so is the other half; do not merge without it.
- **Both repos are public.** Scrub amounts, partner names, hostnames and real filing figures from
  anything posted.
