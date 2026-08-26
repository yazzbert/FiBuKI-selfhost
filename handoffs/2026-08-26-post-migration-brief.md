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
   2026-08-26-report-for-felix.md`, published as artifact `b3bf6a46`. It is the document the
   walkthrough runs on. Do not send him the living HTML report instead — different audience.
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
drained of code and now of issues: 3 open, all held. Upstream carries 40 open issues, of which
#155–#171 arrived in the migration.

**#89 is closed.** Felix carries the Austrian module as a full feature; only its *presentation*
(plain / opt-in / Austria-first) is open, and that is a walkthrough question, not a ticket.

**#98 is deliberately open.** The migration half is done; archiving the fork waits on #99.

## What is actually left

**Nothing here is blocking, and none of it is a lane.** Three things are moving, none of them
ours to force:

1. **The walkthrough with Felix.** He reviews all six waves with Stefan before any deploy. Put the
   four standing questions on that agenda — they have been carried since #85 and belong to him:
   why fork PR #79 was closed without a comment; one shared pagination helper instead of three
   call sites (settled in PR #175: measured, only the cursor decode was common, and the reason
   to extract it is that it carries the ownership check — the two `nextCursor` rules stay
   separate. Felix can still disagree, but the question now has an answer to react to); and how the Austrian module is presented. **The Paperless-anchor
   question is answered** — PR #176 replaced every `paperless-ap-NNNN`, own `IV-YY-NNNN`,
   `FIBU_YYYYMMDD-NNNN`, the private research path and a named restaurant with descriptive
   fixture ids, and `scripts/check-corpus-anchors.js` now fails CI before `npm ci` if one comes
   back. Fixture prose describes documents instead of citing them.
2. **That cluster is now down to #232 and #149.** Updated 2026-08-26 evening:
   - **#229 and #233 are DONE** — upstream PR #178, 9/9 green, merged; both fork issues closed
     by hand afterwards (a cross-repo `Closes` links but never closes — see
     [[reference_github_crossrepo_closes]]). The § 11 classifier now stores whether the named
     recipient IS the user and blocks a third party's VAT from the UVA; `invoiceDirection` has
     a review flag, a `list_files` filter, an editor on both paths, and an unplaced amount no
     longer renders as green income.
   - **#116 is merged** — PR #175, and with it the shared-pagination-helper answer below.
   - **#232 is the remainder of that cluster** and is untouched: extraction misreads the
     recipient block, which is the mechanism behind #229. #229's rule works on whatever
     extraction produced, so a misread recipient still lands wrong — it just lands visibly now.
   - **#149 has not started**; its brief is `handoffs/2026-08-26-issue-149-brief.md`.
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

**Upstream #174 stays open for the six siblings**, and now carries their corrected line numbers —
the four in `firestore-shim.ts` moved to 480/487/504/613 when #177 landed, so read alert NUMBERS,
not lines. Its split: **#282/#283/#284 are mechanical** with a `Map` (check `customMetadata` in
`storage-routes.ts` first — it is handed to the storage SDK). **#279/#280/#281 are not**: they
walk a dot-path into an *existing* decoded document, so there is no accumulator to replace and a
written dismissal is the likely honest answer, especially for #281, which is a `delete`.

## Owed by Felix, unchanged

`firebase deploy --only functions`. It carries `retryFileExtraction` **with** its authentication
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

- Do not open lanes against the held issues, or against #116/#149.
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
