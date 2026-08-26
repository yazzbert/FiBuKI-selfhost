Land what is left upstream on felixtosh/FiBuKI, and get the deploy owed. Read first,
and do not re-derive what these already say:

  1. Memory: project_fibuki_selfhost (the 2026-08-26 "wave 6 MERGED" section first —
     it supersedes every earlier same-day section), then
     feedback_frontend_autodeploys_functions_do_not,
     feedback_leaked_background_loop_flakes_a_later_test,
     reference_github_actions_outage_signature,
     reference_fibuki_stacked_pr_ci_carrier, reference_fibuki_landing_report,
     index-webdev.md.
  2. The map felixtosh/FiBuKI#93 — it carries execution, not only planning.
  3. The living report: syh-company/projects/fibuki-development/reports/
     2026-08-26-landing-report.html, and STATUS.md beside it. Update the changelog
     and the cards as you work (protocol in reference_fibuki_landing_report;
     syh-company push gates apply: check-data.py, check-append-only.sh,
     markdownlint-cli2@0.22.1 on **/*.md).

## Resume here first: #153 may still be open

Waves 1-6 are merged. **Except possibly #153** (upstream #121, retiring
`lib/currency/converter.ts`). At the end of the 2026-08-26 session it was:

  - retargeted to `main`, ready for review, head `ee41da7e` (a merge of `main` into
    `lane/retire-currency-converter`);
  - **waiting on CI that GitHub had not dispatched**, because an Actions Critical
    outage (15:11 UTC) was still "ramping traffic back up slowly".

So: check it. If it is merged, delete `lane/retire-currency-converter` and move on.
If it is open, poll its checks and merge on green — **Stefan's say-so is still the
other half of the gate, and it was given for this merge**. Felix's per-lane review
stays waived until map #93 is done.

Its content was verified locally before the push (5 + 12 + 9 api-smoke tests, plus
the 33-test self-host auth-client file), and the identical tree already went 8/8
green as `2901410a` on carrier #154 before the outage. The re-run is diligence
against a moved trunk, not doubt about the code.

**If a check is red with no logs, read reference_github_actions_outage_signature
before touching the branch.** A `startup_failure` cannot be rerun and reopening the
PR will not re-dispatch once that SHA has one successful run; only a new head SHA
clears it.

## Then: the deploy, which is a security fix and is still owed

Felix has still not run `firebase deploy --only functions`. It carries:

  - `retryFileExtraction` with authentication and an ownership check. **In production
    today that callable takes a bare fileId and re-extracts it without reading
    `request.auth` or the file's `userId`** — any caller can spend another account's
    extraction budget and reset that account's partner and transaction matching.
    Merged since wave 5, not deployed, so not fixed.
  - `calculateUva`, added by the wave-2 chain and never deployed. The UVA page calls
    a function that does not exist.
  - `prepareUvaFiling`, `scheduledRefreshEcbRates` (daily 17:15 Vienna; seeds the ECB
    store from the full history on first run), the billing callables, the § 11 sync
    triggers, `reclassify_documents`.

**New since wave 6, and worth saying to Felix in one line:** `scheduledRefreshEcbRates`
is no longer only about the UVA. Display conversion now reads the same store, so until
that job has run once, the file and transaction surfaces show **no converted figure at
all** for a foreign-currency amount. That is not a regression — it is what they already
showed for every date after April 2025 — but it does mean the deploy is the single
thing standing between the app and working conversion.

Then `firebase deploy --only firestore:rules` for the `uvaFilings` (+ its `snapshots`
subcollection) and `fxReferenceRates` blocks. That half is hygiene: both are written by
the Admin SDK, which bypasses rules, and neither is read from a client. **Wave 6 needed
no rules change of its own** — `/api/fx/rates` reads `fxReferenceRates` server-side
precisely because the client is denied it.

The Firebase project id **is** in the repo (`functions/src/extraction/retryExtraction.ts`
falls back to it), so deployed state can be checked rather than inferred — but ask
Stefan before touching a live project.

## Open upstream, in the order they are worth doing

  - **#116** `list_files` caps at 100 and filters after the limit. Its pagination is the
    context that surfaced in every MCP conflict of waves 3 to 5, so landing it stops a
    recurring tax. Best value of the four.
  - **#149** a correction made in the UI writes straight to Firestore via
    `lib/operations/file-ops.ts:updateFileExtractedFields` and leaves no provenance, so
    half of #147's protection is missing. The fix is to route that write through a
    callable — which is what the repo's own Cloud Functions pattern asks for anyway.
    Do not duplicate the stamping rule client-side; deciding what actually moved is
    domain logic that already exists on the server.
  - **#145** `orderBy("__name__")` is unmapped in the self-host query pushdown, so a
    paged sweep loses ORDER BY, keyset cursor and LIMIT and re-reads the whole
    collection per page.
  - **#112** `toDateSafe` edge cases.

## Standing questions nobody has answered

Carried since wave 3, and they belong to Felix, not to a lane:

  - Why was fork PR #79 closed without a comment? (asked on #85, carried through #115)
  - One shared pagination helper instead of three call sites? (#85 → #115) — #116 is
    the natural place to settle this.
  - `paperless-ap-NNNN` anchors are all over `main` from earlier waves. Pre-existing,
    not introduced by any recent lane, but both repos are public and it is Stefan's
    decision whether they stay.

## Method that still applies

  - **Host safety.** Never a full `vitest`, a project-wide `tsc`, or a full Next.js
    production build on this box — the guard hook blocks those shapes and the box OOMs.
    Scoped only: `npx vitest run <one-file> --pool=forks --maxWorkers=1`. Self-host tests
    run from `functions/` with `--config vitest.selfhost.config.ts`; app-route and
    repo-root `lib/` tests with `--config vitest.api-smoke.config.ts`. **No parallel
    sub-agents here** — which also means `/code-review` fans out too wide; review inline
    instead and say so in the PR. It earned its keep in wave 6: two real defects, both
    fixed before merge.
  - Note the guard hook matches on the command STRING, so a heredoc that merely
    *mentions* one of those command shapes is blocked too. Write such a file with the
    editor tool rather than `cat <<EOF`.
  - A scoped typecheck that actually works in a worktree: write a `tsconfig.scoped.json`
    extending `./tsconfig.json` with a narrow `include`, then
    `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit -p
    tsconfig.scoped.json`. Filter `TS7016`/`TS7006` — those are the worktree's symlinked
    `node_modules` failing type resolution, not your code. Delete the file afterwards.
  - **Worktrees** off origin/main under `~/Projects/Fibuki Self-Host/` — wt-b106 and
    wt-b107 have node_modules symlinks. Never `git stash -u` there; it eats the symlinks.
    To move uncommitted work between branches, copy the files aside and `git checkout --`.
  - **MCP tool files**, if a lane touches them: union-check tool names against main (48
    today), regenerate `lib/data/generated-tool-definitions.ts` with
    `scripts/generate-tool-definitions.js`, never hand-merge it.
  - **Push and PR-create need the classic token in the URL**:
    `git push https://x-access-token:$GH_CLASSIC_TOKEN@github.com/felixtosh/FiBuKI.git b:b`
    and `GH_TOKEN=$GH_CLASSIC_TOKEN gh pr create`. A bare `git push` after sourcing
    `~/.secrets/github-classic.env` returns 403, and `--force-with-lease` needs the
    explicit `=branch:sha` form because pushing by URL updates no remote-tracking ref.
  - **CI**: `ci.yml` fires only on base=main, so a stacked PR needs a draft carrier from
    the chain tip. Close the carrier BEFORE retargeting the tip, or the retarget 422s.
    Poll `.status == "COMPLETED"` and read explicit `conclusion == "SUCCESS"` — and
    guard the poll on the check COUNT too. An empty check list reads as "all green" in
    the obvious jq one-liner, which is a false green, not a pass.
  - **Merge order with independent lanes**: merge the independent one LAST.
  - Draft PR → CI green → `gh pr ready` → review → merge, sequentially.
  - **Gates.** Felix waived per-PR review UNTIL THE WAYFINDER MAP #93 IS DONE — standing,
    not per-day. Stefan's say-so is the other half; do not merge without it.
  - **Both repos are public.** Scrub amounts, partner names, hostnames and real filing
    figures from anything you post.
