# CodeQL backlog triage — 265 pre-existing alerts on main

## Session 2026-07-20/21 — outcome

PRs #3–#6 merged; main scans closed **16 alerts as fixed** (265 → 250
open, security-severity 99 → ~84): #25–#30 request-forgery, #32, #34,
#37, #66–#68, #87, #113/#114, #123. Adversarial review added two extra
fixes (chmod-600-on-existing-config; runtime bankConnectionId validation
that CodeQL's type-based taint missed).

Still to run/decide from this round:
- Dismissals #33, #81, #82 (commands in `2026-07-20-codeql-dismissals.md`;
  #32/#87 self-resolved via the hardening, entries removed).
- PR #7 (`fix/publish-packages-secret-gate`): merge — the cli/ merge
  tripped the fork-inherited npm auto-publish (ENEEDAUTH, repo has no
  secrets); PR gates publish steps on token presence. Checks green.
- npm `@fibukiapp/cli@0.1.1` (ships the #34 fix): **blocked on Felix** —
  the @fibukiapp npm scope is his. Options: he publishes, adds Stefan as
  package maintainer, or provides a granular token for the NPM_TOKEN
  secret; then `gh workflow run publish-packages.yml -f publish_cli=true`.
- Extension 0.0.2 (sandbox hardening) isn't on the Chrome Web Store until
  a GitHub Release is published (RELEASING.md procedure).

**Deferred with analysis:** js/system-prompt-injection ×2
(app/api/agent/route.ts:72, app/api/chat/route.ts:260) — client-sent
`role:"system"` messages replace the server's SYSTEM_PROMPT (chat route
only unshifts its own when none present; agent route round-trips system
messages to the client). Dropping them is a real behavior change to
chat/agent flows — needs its own session or Stefan's call.
**Still pending:** priority 3 rest (regex-anchor ×8 in extension,
user-controlled-bypass ×2 in content.js — login-page heuristics, likely
by-design), priority 4 bulk mediums, priority 5 quality noise (+ the
security-extended vs security-and-quality suite question for Stefan).

---

**Status:** Queued by Stefan 2026-07-20, to run BEFORE the transactions
flatten (`2026-07-20-phase-1-flatten-transactions.md` stays pending).
Context: the first-ever CodeQL scan of `main` (post PR #1/#2 merge,
2026-07-20) surfaced 265 open alerts / 99 security-severity across the
LEGACY codebase. None are in the selfhost or Phase-1 code; nothing here
blocks phase work (PR checks only fail on NEW alerts in changed code).
This is standalone hardening.

## Goal

Work the security-severity backlog down in priority order, with fixes as
small reviewable PRs to `main`. Quality-only rules (147× unused-local-
variable etc.) are a mechanical cleanup PR or a query-suite decision — do
them last, if at all.

## Getting the data

`gh` CLI is at `~/.local/bin/gh`, authed as yazzbert (use it — anonymous
API calls burn the 60/hr IP rate limit):

```bash
gh api --paginate "repos/yazzbert/FiBuKI-selfhost/code-scanning/alerts?state=open&per_page=100"
# full taint flows: /code-scanning/analyses?ref=... then fetch the analysis
# id with Accept: application/sarif+json
```

## Priority order (from the 2026-07-20 snapshot)

1. **Singleton highs, one look each:** js/code-injection,
   js/command-line-injection, js/http-to-file-access,
   js/unvalidated-dynamic-method-call, js/insufficient-password-hash
   (`functions/src/api-keys/index.ts:44` — check what's actually hashed;
   an sha256'd random API key is fine, a password is not).
2. **Server-side flows:** js/request-forgery ×6, js/system-prompt-injection
   ×2, js/clear-text-logging ×2, js/tainted-format-string ×3.
3. **Extension (61 alerts in extensions/taxstudio-browser):**
   js/missing-origin-check ×2 (postMessage handlers — real), regex-anchor
   ×8, remote-property-injection in content.js.
4. **Bulk medium:** js/log-injection ×25, js/incomplete-url-substring-
   sanitization ×26, js/incomplete-multi-character-sanitization ×9,
   js/regex/missing-regexp-anchor rest.
5. **Quality noise:** unused-local-variable ×147, useless-assignment ×8,
   trivial-conditional ×8 — mechanical PR or dismiss; consider whether the
   workflow should run `security-extended` instead of
   `security-and-quality` (that's a Stefan decision, ask).

## Lessons already paid for (don't rediscover)

- CodeQL only recognizes sanitizers as **literal comparisons on the guarded
  variable at the sink** (`k === "__proto__" || ...`), not Set/helper
  wrappers. `Buffer.isBuffer` ternaries are NOT modeled → such alerts are
  dismiss-as-false-positive territory.
- Some alerts are **by-design residue** (see the 10 dismissed on
  2026-07-20 with comments). Dismissal comments are capped at **280
  chars**. Claude's classifier blocks both `git push` and alert dismissal —
  prepare a script for Stefan (pattern: the deleted
  ~/dismiss-codeql-alerts.sh; see memory).
- Fixing an alert only closes it after a `main` scan — i.e. after the PR
  merges (push-to-main trigger). Don't chase per-PR alert counts.

## Rules / guardrails

- **Port, never regenerate** (docs/rewrite-goals.md): several flagged sites
  sit inside domain logic (precision-search, matching, lookupCompany).
  Minimal, behavior-preserving fixes only; characterization + parity +
  selfhost suites must stay green (they pin real bugs on purpose — never
  "fix" pinned values without Stefan).
- Extension changes: read /extensions/taxstudio-browser/RELEASING.md before
  touching anything release-related.
- Suites (from functions/): default `npx vitest run --pool=forks
  --maxWorkers=1` (706), selfhost `--config vitest.selfhost.config.ts`
  (250), parity via emulator (130), `NODE_OPTIONS="--max-old-space-size=900"
  npx tsc --noEmit`. App-side (`app/`, `lib/`, `components/`, `hooks/`) has
  NO test runner at repo root — extra care + tsc/lint via `npm run` scripts
  there; CI's app job covers lint+typecheck+build.
- 6 GiB host: guard-memory hook active, no parallel sub-agents, PATH needs
  ~/.local/node/bin (+ java for the emulator).
- Branch off `main`, PR to `main` (CI only triggers on PRs to main).

## Non-goals

- No rewrite-phase work (transactions flatten has its own handoff).
- No refactors beyond what a fix needs. No new abstractions.
- Don't disable CodeQL rules globally without Stefan's sign-off.
