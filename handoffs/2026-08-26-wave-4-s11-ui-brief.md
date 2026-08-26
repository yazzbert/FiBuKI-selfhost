Continue landing FiBuKI follow-up lanes onto felixtosh/FiBuKI main. Read first, in
this order, and do not re-derive what they already say:

  1. Memory: project_fibuki_selfhost (the 2026-08-26 wave-3 section first — it
     supersedes the earlier same-day sections), then
     feedback_frontend_autodeploys_functions_do_not,
     reference_fibuki_stacked_pr_ci_carrier, reference_fibuki_landing_report,
     index-webdev.md.
  2. The map felixtosh/FiBuKI#93, and the 2026-08-26 wave-3 comment on #89 — it
     lists exactly what still lives on the fork.
  3. The living report: syh-company/projects/fibuki-development/reports/
     2026-08-26-landing-report.html — update its changelog and cards as you work
     (protocol in reference_fibuki_landing_report; syh-company push gates apply).
     Its wave-3 section is the shape to match. PR #54 on syh-company may still be
     open; if so, add to that branch rather than opening a second one.

State: waves 1-3 are MERGED. #122-#127 (billing cycle, UVA, § 11), then #129
(non-claimable VAT), #130 (the filing record), #131 (§ 20 Abs 6 ECB rate). Landing
#131 unblocked upstream #120, and behind it #121 — check whether either has moved.

Review gate: Felix waived per-PR review UNTIL THE WAYFINDER MAP #93 IS DONE. That is
standing, not a per-day waiver. Stefan's say-so is still the other half; do not merge
without it. Both repos are public: scrub amounts, partner names, hostnames, and real
filing figures from anything you post — including commit messages you carry over from
the fork, which contain them.

Next wave candidates, in measured fork/stefan-prod order (oldest first):
  - #205 (3d337398) — document type, decision basis and missing § 11 elements on the
    file surfaces. Creates components/documents/document-type-badge.tsx,
    section-11-details.tsx and lib/documents/document-type-presentation.d.ts.
  - #204 (e32fdc27) — the write path for the § 11 classifier
    (functions/src/documents/reclassifyStoredDocuments.ts + MCP tools). Backend only;
    looks independent of the two UI lanes except through documents/adapter.ts and the
    tool files.
  - #207 (901fca5e) — documentation state on transaction rows plus the receipt-only
    chase queue. MODIFIES both files #205 creates, so it depends on #205. Measured by
    file creation, not by cherry-pick — prove it with the pick.
  - #74 (ede69205) — re-extraction from the UI and over MCP; creates
    functions/src/extraction/retryExtractionOps.ts and restores retry_file_extraction.
    Its OpenAPI description was cut from #127's re-cut AND its handler was dropped
    again resolving #129's conflicts, so grep main for what is missing before cutting.
  - #184 (42b3174b) — hand corrections that re-extraction respects. Modifies
    retryExtractionOps.ts, so it depends on #74.
  - Upstream filed-not-fixed: #112 toDateSafe edge cases, #116 list_files cap. #116's
    pagination is the context that surfaced in every MCP conflict of wave 3; landing it
    would stop that recurring.

Method per #97, plus what waves 1-3 added:
  - MEASURE THE DEPENDENCY LINE BEFORE CUTTING. The stated order has now been wrong
    twice. Cherry-pick each candidate onto main and read the conflicts: a modify/delete
    is a hard dependency, and re-ordering turned six conflicts into one last time.
    Ancestry is not dependency, and neither is the order in the brief you are reading.
  - Topic-sweep fork/stefan-prod for each lane; never trust branch tips. Every re-cut
    so far has needed a semantic fix that no ancestry check would find.
  - Verify the re-cut diff matches its fork commit stat exactly after stripping. If it
    does not, un-landed context has leaked in.
  - Worktree off origin/main under ~/Projects/Fibuki Self-Host/ (wt-b106 and wt-b107 are
    set up with node_modules symlinks); never git stash -u there. Scoped vitest only
    (--pool=forks --maxWorkers=1); selfhost tests need --config vitest.selfhost.config.ts.
    The guard hook blocks on substrings, so avoid the bare word in shell pipelines.
  - Empty-main-side conflict hunks carry other lanes' context — resolve to the commit's
    own additions (git show <sha> -- <file>), then grep the branch diff for un-landed
    lanes' symbols.
  - MCP tool files: union-check tool names against main, regenerate
    lib/data/generated-tool-definitions.ts, never hand-merge it. functions/lib is stale
    in a worktree; transpile definitions.ts with functions/node_modules/.bin/esbuild
    before running scripts/generate-tool-definitions.js.
  - THE DEPLOY-GAP CHECK IS NOW STANDING. These are UI lanes, so it matters more than
    ever: the web app auto-deploys from main and Cloud Functions do not. Any field a
    lane adds to a callable's response and reads in a component must tolerate absence.
    Three of wave 3's nine findings were exactly this.
  - ci.yml fires only base=main: stacked PRs need a draft CI-carrier PR (chain tip →
    main, never merged). Close the carrier BEFORE retargeting the tip to main, or the
    retarget 422s on the head/base pair. Retarget every downstream PR to main BEFORE
    deleting any base branch.
  - Draft PR → CI green (poll .status=="COMPLETED" + conclusion=="SUCCESS"; 9 checks
    when CodeQL joins) → gh pr ready. /code-review before merge — sequentially, no
    parallel sub-agents on this box. Push and PR-create need the classic token from
    ~/.secrets/github-classic.env; gh's default credential is not authorised on
    felixtosh/FiBuKI.

Owed, and worth opening with: Felix still has not run `firebase deploy --only functions`.
calculateUvaCallable.ts was added by the wave-2 chain and has NEVER been deployed, so the
UVA page on fibuki.com currently calls a function that does not exist — the feature is dark,
not degraded. Also owed now: prepareUvaFiling, scheduledRefreshEcbRates (daily 17:15 Vienna,
seeds the ECB store from full history on first run), the billing callables, the § 11 triggers,
then `firebase deploy --only firestore:rules` for the uvaFilings (+ its snapshots
subcollection) and fxReferenceRates blocks. This was read off git history and NOT verified
against the live project — new-api.fibuki.com is the self-host API origin, not the cloud
functions host, and the Firebase project id is not in the repo. If verifying matters, ask
Stefan for the project id rather than guessing.
