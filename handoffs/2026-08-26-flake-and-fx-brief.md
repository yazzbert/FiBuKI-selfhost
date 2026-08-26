Fix the flaky CI gate, then retire the hardcoded rate table, on felixtosh/FiBuKI main.
Three upstream tickets: **#150, then #120, then #121**, in that order. Read first, and do
not re-derive what these already say:

  1. Memory: project_fibuki_selfhost (the 2026-08-26 "waves 4 + 5 MERGED" section first —
     it supersedes every earlier same-day section), then
     feedback_frontend_autodeploys_functions_do_not,
     feedback_ported_commit_can_carry_instance_data,
     reference_fibuki_stacked_pr_ci_carrier, reference_fibuki_landing_report,
     index-webdev.md.
  2. The map felixtosh/FiBuKI#93, and the two 2026-08-26 wave-4/wave-5 comments on #89.
  3. The three tickets themselves: #150 (with its comment naming the mechanism), #120, #121.
  4. The living report: syh-company/projects/fibuki-development/reports/
     2026-08-26-landing-report.html — update its changelog and cards as you work (protocol
     in reference_fibuki_landing_report; syh-company push gates apply). syh-company PR #54
     may still be open on branch docs/fibuki-wave-3; if so, add to that branch.

## State

**Waves 1-5 are MERGED and the fork is drained.** Everything the landing brief listed is on
the trunk: #122-#127, #129-#131, then #141/#143/#142 (§ 11 surfaces, the write path, the
transaction rows and the chase queue) and #146/#147 (re-extraction, hand-correction
provenance). All lane branches deleted, both CI carriers closed unmerged. Verified on main:
48 MCP tool names, `retry_file_extraction` and `reclassify_documents` present,
`stamp_known_hand_corrections` and its instance-data table correctly absent.

This is the first session in the landing sequence with **no fork lane to port**. The work is
upstream tickets now, written from scratch against main.

## Open with this: the deploy is a security fix and is still owed

Felix has still not run `firebase deploy --only functions`. It now carries:

  - `retryFileExtraction` with authentication and an ownership check. **In production today
    that callable takes a bare fileId and re-extracts it without reading `request.auth` or
    the file's `userId`** — any caller can spend another account's extraction budget and
    reset that account's partner and transaction matching. Merged, not deployed, so not
    fixed.
  - `calculateUva`, added by the wave-2 chain and never deployed. The UVA page calls a
    function that does not exist.
  - `prepareUvaFiling`, `scheduledRefreshEcbRates` (daily 17:15 Vienna; seeds the ECB store
    from the full history on first run), the billing callables, the § 11 sync triggers,
    `reclassify_documents`.

Then `firebase deploy --only firestore:rules` for the `uvaFilings` (+ its `snapshots`
subcollection) and `fxReferenceRates` blocks. The frontend for all of it self-deploys from
main and is live now; every new field read tolerates absence, so the pages are correct but
inert until the functions land. The Firebase project id **is** in the repo
(`functions/src/extraction/retryExtraction.ts` falls back to it), so deployed state can be
checked rather than inferred — but ask Stefan before touching a live project.

## 1. #150 — the flaky OIDC lock test (do this first, it gates everything else)

`functions/src/selfhost/auth-client.test.ts`, describe "selfhost auth-client — OIDC refresh
serialisation (fork #73)", test "serialises through navigator.locks when the browser provides
it". Failed once on #146 and once on #147 today, passed on re-runs of both identical commits:

```
AssertionError: expected [ 'fibuki-oidc-refresh', …(1) ] to deeply equal [ 'fibuki-oidc-refresh' ]
```

**Mechanism, already established — do not re-derive it.** The `staleSet` helper (around line
667) seeds `expires_at: Date.now() + 5_000` and an id_token expiring in five seconds, so the
tab arms its own proactive refresh. The test then does `openTab()` (which is
`vi.resetModules()` + a fresh import), `tick()`, and awaits one `getIdToken()`, and asserts
that `inside` — every lock taken over that whole span — has exactly one entry. So the
assertion holds only while the span finishes inside a five-second wall-clock budget. Waves 4
and 5 added files to the same self-host suite, the run got slower, and the budget now blows
often enough to cost a re-run per wave. `main` gates production deploys, so re-running is not
a strategy.

Constraints on the fix:

  - **Keep the property.** The test exists to pin "one lock, held around the refresh — not
    the lease fallback". Do not loosen it to `toContain` or drop the
    `toHaveBeenCalledTimes(1)`. Make the window deterministic instead: fake timers around
    the tab's schedule, or scope the assertion to locks taken during the awaited call.
  - **Prove the fixed test can still fail.** Break the implementation deliberately (make it
    take the lock twice, or fall through to the lease path) and watch the test go red before
    you call it done. A flake fixed by making the assertion unfalsifiable is worse than the
    flake.
  - Check the sibling tests in the same describe (`two tabs refreshing at once…` and the
    others seeded with `staleSet`) for the same latent budget. If they share it, say so on
    the ticket even if you only fix the one that fires.

Run it from `functions/`:

```bash
npx vitest run src/selfhost/auth-client.test.ts --pool=forks --maxWorkers=1 --config vitest.selfhost.config.ts
```

## 2. #120 — the hardcoded EUR_RATES table

Measured on main just now, so start from this rather than from the ticket's older framing:

  - `lib/currency/converter.ts` still holds `EUR_RATES`, 39 monthly rows, four currencies
    (USD, GBP, CHF, JPY). Its endless "newest row" fallback is **already gone** — #118
    landed `MAX_RATE_SUBSTITUTION_MONTHS = 3` and returns null past it. So the silent-wrong
    path is closed and what remains is a display cliff: anything past roughly April 2025
    shows no converted figure at all.
  - The replacement source **is on main**: `functions/src/fx/ecbRateStore.ts`
    (`fxReferenceRates`, `loadEcbRateTable`, `storeEcbDays`, `ecbRateStoreIsEmpty`),
    `functions/src/fx/ecbRates.ts`, `functions/src/fx/refreshEcbRates.ts`
    (`scheduledRefreshEcbRates`, daily, 90-day rolling feed, full-history seed on first run).
  - So #120 is no longer "land the cron". It is: point display conversion at the store the
    cron fills, and delete the table.

Two things that decide the shape, both stated rules rather than preferences:

  - **The client never touches the DB** (`docs/rewrite-goals.md`). So the components read
    through an API route or a callable, not Firestore directly. #121 says the same.
  - **The deploy gap is a standing check** and it bites hardest here. The store is empty
    until `scheduledRefreshEcbRates` has run once in the target project, and the function is
    not deployed yet. A component that reads the store must render the existing
    conversion-failed path when it comes back empty, never crash and never show a zero. Test
    that path explicitly.

Sequencing question worth answering before writing code: whether the table is deleted in
#120 or left in place as a fallback until #121. The ticket assumes the latter. Measure how
the five consumers behave with an empty store before you decide, and write the answer on the
ticket.

## 3. #121 — retire lib/currency/converter.ts

Blocked on #120 and cheap once it lands. Five consumers, all display-only, none server-side:

```
components/ui/amount-match-display.tsx
components/files/file-connections-list.tsx
components/files/file-extracted-info.tsx
components/files/file-columns.tsx
components/transactions/transaction-files-section.tsx
```

Also: `functions/src/api-smoke/currency-converter.test.ts` moves to cover whatever replaces
the module rather than being deleted with it. Currency coverage stops being two lists (four
in the frontend, thirteen approximate anchors in `functions/src/fx/fxPlausibility.ts`, and
whatever the ECB publishes) — say which one wins, in the PR.

Do not touch `FX_REFERENCE_TO_EUR` while doing this. Those thirteen anchors exist to gate
plausibility with deliberately wide tolerances and must not become a conversion source; the
wave-3 review already had to defend the same line for income under Ist-Besteuerung.

## Method that still applies

  - **Host safety.** Never a full `vitest`, project-wide `tsc`, or `next build` on this box —
    the guard hook blocks those shapes and the box OOMs. Scoped only:
    `npx vitest run <one-file> --pool=forks --maxWorkers=1`. Self-host tests run from
    `functions/` with `--config vitest.selfhost.config.ts`. No parallel sub-agents here.
  - **Worktrees** off origin/main under `~/Projects/Fibuki Self-Host/` — wt-b106 and wt-b107
    have node_modules symlinks. Never `git stash -u` there; it eats the symlinks.
  - **MCP tool files**, if a lane touches them: union-check tool names against main (48
    today), regenerate `lib/data/generated-tool-definitions.ts` with
    `scripts/generate-tool-definitions.js`, never hand-merge it. `functions/lib` is stale in
    a worktree — transpile `definitions.ts` with `functions/node_modules/.bin/esbuild` first.
  - **Push and PR-create need the classic token in the URL**:
    `git push https://x-access-token:$GH_CLASSIC_TOKEN@github.com/felixtosh/FiBuKI.git b:b`
    and `GH_TOKEN=$GH_CLASSIC_TOKEN gh pr create`. A bare `git push` after sourcing
    `~/.secrets/github-classic.env` returns 403, and `--force-with-lease` needs the explicit
    `=branch:sha` form because pushing by URL updates no remote-tracking ref.
  - **CI**: `ci.yml` fires only on base=main, so a stacked PR needs a draft carrier from the
    chain tip. Close the carrier BEFORE retargeting the tip, or the retarget 422s. Poll
    `.status == "COMPLETED"` and read explicit `conclusion == "SUCCESS"`; nine checks when
    CodeQL joins.
  - **Merge order with independent lanes**: merge the independent one LAST. Waves 4 and 5
    proved the cost — #142 and #146 each added an MCP tool at the same array position, so
    #146 went red the moment #142 landed and needed a union merge of main.
  - Draft PR → CI green → `gh pr ready` → `/code-review` before merge, sequentially.
  - **Gates.** Felix waived per-PR review UNTIL THE WAYFINDER MAP #93 IS DONE — standing, not
    per-day. Stefan's say-so is the other half; do not merge without it.
  - **Both repos are public.** Scrub amounts, partner names, hostnames and real filing
    figures from anything you post.

## Also open, not this session's work

  - #112 `toDateSafe` edge cases; #116 `list_files` caps at 100 and filters after the limit —
    #116's pagination is the context that surfaced in every MCP conflict of waves 3 to 5, so
    landing it would stop a recurring tax.
  - #145 `orderBy("__name__")` is unmapped in the self-host query pushdown, so a paged sweep
    loses ORDER BY, keyset cursor and LIMIT and re-reads the whole collection per page.
  - #149 a correction made in the UI writes straight to Firestore via
    `lib/operations/file-ops.ts:updateFileExtractedFields` and leaves no provenance, so half
    of #147's protection is missing until that write routes through a callable. Same
    Cloud-Functions-pattern violation as the #120/#121 question above — worth doing together
    if the shape turns out to be shared.
