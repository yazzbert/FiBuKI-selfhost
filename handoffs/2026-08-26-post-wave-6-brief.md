Get FiBuKI ready to present to Felix: a report of everything six waves changed, the
security fix deployed ahead of that review, and the fork's issues migrated. Read first,
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

**Getting CI to fire on it may need a new head SHA.** Three close/reopen cycles produced
nothing, or produced runs on the superseded `2901410a` (which did go 9/9 green, on the
identical tree). GitHub will not re-dispatch a branch that already has a successful run,
and the reopen path reads a stale head. The unblock is `git commit --amend --no-edit
--date=now` on the merge commit plus a `--force-with-lease` push, which fires a real
`synchronize`. That amend was blocked by the sandbox in the session that wrote this, so it
is the first thing to try, not a last resort.

Upstream **#120 is already closed by hand** — #152 said `Refs` rather than `Closes`, so it
stayed open after merging. #121 will close itself when #153 lands.

Its content was verified locally before the push (5 + 12 + 9 api-smoke tests, plus
the 33-test self-host auth-client file), and the identical tree already went 8/8
green as `2901410a` on carrier #154 before the outage. The re-run is diligence
against a moved trunk, not doubt about the code.

**If a check is red with no logs, read reference_github_actions_outage_signature
before touching the branch.** A `startup_failure` cannot be rerun and reopening the
PR will not re-dispatch once that SHA has one successful run; only a new head SHA
clears it.

## Stefan's direction, 2026-08-26 (this changes the shape of the next wave)

Three decisions, taken after wave 6 merged:

  1. **Felix does not deploy until he and Stefan have gone through the changes together**,
     and he wants them as a **report** first. So the next deliverable is a document, not a
     lane. See "The report for Felix" below.
  2. **`fibuki.home.syh.at` stays pointed where it is until Stefan's taxes are filed.**
     That is upstream #99 — do not touch it, and do not treat it as blocked-on-us.
  3. **The fork's open issues get migrated now** (upstream #98), and Stefan wants them
     **re-evaluated, grouped where sensible, and renamed to fit the main repo** on the way
     across — not bulk-copied.

**The one thing to raise against decision 1, once, and then respect the answer.** The
deploy is not only features: `retryFileExtraction` in production today takes a bare
`fileId` and re-extracts it without reading `request.auth` or the file's `userId`. Every
day of review is a day that stays open. It can be closed on its own without prejudging
anything else, because Firebase deploys per function:

```bash
firebase deploy --only functions:retryFileExtraction
```

That is the smallest diff in the whole set and the easiest thing to review in isolation.
Offer it as a split — security fix now, everything else after the walkthrough. If Stefan
still wants it held, hold it; the call is his and it is a legitimate one.

**Also say plainly, once:** holding the deploy is not a neutral "nothing ships yet"
position. The frontend auto-deploys from `main` and all six waves are already live on
`fibuki.com`. So production is running the new UI against the old backend right now:
the UVA page calls a `calculateUva` that does not exist, `reclassify_documents` is in the
MCP catalog and errors when called, and since #152 a foreign-currency amount shows no
converted figure. Holding is a choice to keep that state, which is fine as a decision and
bad as a default.

## The report for Felix

What it has to cover: six waves, ~16 merged PRs, from #109 through #153. Suggested shape,
not prescriptive:

  - **What changed, by theme, not by PR** — self-host runtime, matching/one-scorer, files
    UX + billing cycle, the UVA / § 11 chain, the filing record, § 11 surfaces,
    re-extraction and hand corrections, FX. A PR-by-PR list is a changelog, not a report.
  - **What is now live vs what waits on the deploy**, explicitly, because that gap is the
    thing he most needs to see.
  - **The decisions taken on his behalf while review was waived**, so he can reverse any of
    them: dropping `knownHandCorrections.ts` from #147's port, not keeping `EUR_RATES` as a
    fallback in #120, filing #145/#149/#150 rather than patching them into a lane.
  - **The open correctness issues in the Austrian module** — see #89 below. Do not present
    the module as finished.
  - **What it costs him**: the deploy, the rules deploy, and the review time.

The living report in syh-company is the raw material, but it is written for us. Felix's
report is a different document with a different audience; do not just send him the HTML.
Both repos are public and the report will quote figures — scrub before anything is posted.

## #89 is not waiting on us, and its question has partly expired

Worth understanding before the walkthrough, because Felix will ask.

**#89 is a decision ticket, not a work ticket.** It asks Felix to pick: (1) the Austrian
UVA module goes upstream as an opt-in feature, (2) it stays on the fork forever, (3) only
the generic parts go up. He has already downgraded it from a grilling ticket to an
ordinary bundle, and the `wayfinder:grilling` label came off.

**Option 2 is no longer available.** The module has been on `main` since wave 2 and the
follow-ups since waves 3-5. The standing decision on map #93 — one trunk, `fork/main`
arrives whole — overtook it. Say so rather than letting him answer a question whose answer
is already fixed; what is still genuinely open is how it is *presented* (opt-in? Austria-only
build? documented as such?), which is closer to option 1-versus-3.

**Its own gate was "four correctness issues close first."** Named: the ECB rate source
(→ upstream #120, **closed** by #152/#153), invoice-versus-receipt classification under
§ 11 UStG (landed in waves 2 and 4), and two smaller ones. So on the original four the
gate is essentially clear.

**But do not report it as clear, because of fork #229** — see below. It is a fifth issue
in the same area and worse than any of the four.

## Burning before the walkthrough

Ranked by what would embarrass or mislead in front of Felix, or affect a real tax figure:

  1. **fork #229 — a third-party invoice can put its VAT into the UVA as recoverable.**
     The § 11 classifier requires a recipient to *exist* but never that the recipient is the
     user, so an invoice addressed to someone else classifies `invoice /
     section-11-satisfied`. § 11-correct on its face, § 12-fatal in effect: no
     Vorsteuerabzug exists, yet nothing stops the file matching a transaction and the VAT
     walking into the UVA. Found by a human reading a PDF, not by any check. **This is the
     single most serious open issue on either repo** and it lives in exactly the module #89
     is about. Fix it, or state it prominently in the report. Do not do neither.
  2. **fork #233 — `invoiceDirection` has no review flag, no filter and no editor**, so an
     undirected purchase renders as green income. Figures-facing and demo-facing.
  3. **#116 — `list_files` caps at 100 and filters after the limit, so it can report an
     empty account.** An agent-facing tool that lies. Its pagination is also the context
     that surfaced in every MCP conflict of waves 3 to 5, so fixing it stops a recurring
     tax. Best effort-to-value ratio of the four.
  4. **#149 — a correction made in the UI leaves no provenance**, so half of #147's
     protection is missing. Relevant because the report will otherwise claim hand
     corrections are protected, and today that is only true for the MCP path.
  5. **#70 — FinanzOnline: the encryption key is an unevaluated `$(...)` string** and the
     Webservice-Benutzer account is missing. Not urgent for the walkthrough, but it is a
     credential-handling bug and it reads badly if he finds it himself.

## Migrating the fork's issues (upstream #98)

31 open on `yazzbert/FiBuKI-selfhost` as of 2026-08-26. **Triage before copying** — a
straight migration would carry across at least six that are already dead:

  - `#224 FREEZE: no new feature work on this fork` — meta, dies with the fork.
  - `#49 Meta: land the selfhost/fixes branch upstream as small PRs` — that landing is what
    waves 1-6 were. Fulfilled.
  - `#51`, `#52`, `#53` — each titled "(SOLVED on the fork)". **Verify the fix is on
    upstream `main`** before closing rather than migrating; do not assume.
  - `#214 ZAP Scan Baseline Report` — duplicate of upstream #50.

Grouping candidates Stefan asked about, offered as a starting read rather than a
conclusion: the extraction-accuracy cluster (#150, #225, #230, #232 — all "extraction picks
the wrong thing from the page"), the § 11 / direction-correctness cluster (#229, #233, plus
upstream #149), the self-host platform-gap cluster (#37-#43, #46 — the A/C/E series), and
the matching cluster (#160 semantic duplicates, #227 split part-invoices, #86 stale partner
assignments).

**The renaming is not cosmetic.** The fork titles are written for an audience of one who
already knows the instance. Upstream they need to name the concept, not the incident, and
they must use the glossary's words — File, Rejection, Partner, No-document Category,
Confidence, Documentation State (see `CONTEXT.md` and `docs/adr/`).

**Scrub on the way across, and treat this as the main risk of the whole exercise.**
Upstream is public and several fork issues carry live-corpus data in the body: #229 names a
real client and quotes a document id and its figures, #225 and #230 cite `paperless-ap-NNNN`
anchors, #232 and #231 quote corpus counts. Rewrite the evidence sections into the general
case. The precedent is [[feedback_ported_commit_can_carry_instance_data]] — there the leak
was a whole checked-in table, and the same shape applies to an issue body.

## The deploy, when it is unblocked

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

## Open upstream, mechanics for the ones named above

  - **#116** `list_files` caps at 100 and filters after the limit. Settle the "one shared
    pagination helper instead of three call sites" question here — it has been carried
    since #85.
  - **#149** the UI corrects through `lib/operations/file-ops.ts:updateFileExtractedFields`,
    which builds its own update map and writes straight to Firestore. The fix is to route
    that write through a callable — which is what the repo's own Cloud Functions pattern
    asks for anyway. Do not duplicate the stamping rule client-side; deciding what actually
    moved is domain logic that already exists on the server.
  - **#145** `orderBy("__name__")` is unmapped in the self-host query pushdown, so a
    paged sweep loses ORDER BY, keyset cursor and LIMIT and re-reads the whole
    collection per page. Not walkthrough-blocking; it is a cost, not a wrong answer.
  - **#112** `toDateSafe` edge cases.

Also on the board and NOT ours to move: **#99** (point `fibuki.home.syh.at` at the merged
main) is deliberately parked until Stefan's taxes are filed.

## Standing questions — put these ON the walkthrough agenda

Carried since wave 3 and never answered. They belong to Felix, not to a lane, so the
session with him is the moment to close them:

  - Why was fork PR #79 closed without a comment? (asked on #85, carried through #115)
  - One shared pagination helper instead of three call sites? (#85 → #115) — #116 is
    the natural place to settle this.
  - `paperless-ap-NNNN` anchors are all over `main` from earlier waves. Pre-existing,
    not introduced by any recent lane, but both repos are public and it is Stefan's
    decision whether they stay. The issue migration makes this urgent rather than
    theoretical, because it is the same class of leak at larger volume.
  - The #89 presentation question: opt-in feature, Austria-only build, or generic-parts-only
    — given that option 2 has already expired.

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
