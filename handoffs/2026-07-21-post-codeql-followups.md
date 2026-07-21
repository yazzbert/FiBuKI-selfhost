# Post-CodeQL follow-ups — security backlog is ZERO; hardening + decisions

**Status:** Rounds 0–3 complete. PR #9 (prompt ownership, squash `55143131`)
and PR #10 (51 bulk mediums + review fixes, squash `7eb940ed`) merged
2026-07-21. Open security alerts on main: **0** (verify with the query
below — the post-merge main scan must confirm). Quality noise ×166 remains,
parked on Stefan.

## Session start checks

```bash
gh api "repos/yazzbert/FiBuKI-selfhost/code-scanning/alerts?state=open&per_page=100" \
  --paginate --jq '[.[] | select(.rule.security_severity_level != null)] | length'
# expect 0; if >0, investigate before anything else
```

## Workflow (changed 2026-07-21 — supersedes older handoffs)

- Claude pushes branches itself (`git push fork <branch>`; allow rules live
  in `.claude/settings.json`). `origin` remains off-limits (deploy checkout).
- After CI greens on a PR: self-adversarial review (inline or ≤2 concurrent
  sub-agents — the old "no parallel sub-agents" ban is lifted, cap is 2),
  report findings, then WAIT for Stefan's explicit "merge PR N" before
  `gh pr merge N --squash` (an ask-rule double-confirms).
- Verify CodeQL on `alerts?ref=refs/pull/<N>/merge` — NOT `refs/heads/<branch>`
  (branch refs have no analysis; that query silently returns empty).
- When a handoff prompt is fulfilled, DELETE the file (this one included).

## Task 1: investigate `getServerUserIdWithFallback` (priority — possible auth issue)

PR #10's adversarial review found `lib/auth/get-server-user.ts:21-26`
decodes the JWT **without verification** — `user_id` is attacker-choosable.
For logging that's now sanitized, but if that userId gates data access in
any API route, it's an auth bypass, far worse than log injection. Map every
caller, determine whether a verified path (Firebase Admin `verifyIdToken`)
should replace the decode, check what "fallback" is for (dev mode?). Report
findings to Stefan before changing auth behavior.

## Task 2: hardening from PR #9 review (small, self-contained)

- `lib/agent/graph.ts` ~:96 and `lib/agent/worker-graph.ts` ~:330: graphs
  trust any pre-existing SystemMessage (`hasSystemMessage ? messages : ...`).
  Make the graph strip foreign SystemMessages and always prepend its own;
  then drop the chat route's unshift so ownership lives in one place.
- Real pre-existing bug found: `worker-graph.ts` receipt-gate reminder
  (~:578) is a SystemMessage appended to state → next agentNode iteration
  sees `hasSystemMessage === true` and **drops the worker's actual system
  prompt** (and mid-array system messages may be rejected by ChatAnthropic).
  Fixing the ownership pattern above fixes this too. Port, don't redesign.
- Nit: remove `"system"` from `MessageInput`/`UIMessageInput` role unions
  (dead input since #9).

## Task 3: extension test suite is unwired (needs Stefan's pick)

`extensions/taxstudio-browser-tests/*.test.js` are unrunnable anywhere:
`require("../lib/url-utils")` doesn't resolve from that dir, jest config
(`extensions/taxstudio-browser/jest.config.js`) still points at
`./__tests__/`, jest isn't installed, no CI job runs them. Options: move
tests back under the extension with a CWS-zip exclusion, or point rootDir/
testMatch at the sibling dir + fix requires; either way add a CI job.
Until then the url-utils tests are assertions that can never fail.

## Task 4 (Stefan decisions, unchanged)

- Quality noise ×166 (unused-local ×147, useless-assignment ×8,
  trivial-conditional ×8, misc ×3): dedicated cleanup round vs switching
  suite `security-and-quality` → `security-extended`. If suite stays,
  consider path-based exclusion for generated/ported code.

## Known accepted trade-offs from round 3 (do NOT "fix" without cause)

- iframe-embedding fallback (`content.js` urlParamsReferenceHost) matches
  query params only — no longer path or `#fragment`. Primary detection
  (b64 `hostOrigin` param) is intact. Revisit only if a Google Payments
  pull stalls at iframe self-start.
- `sanitizeForLog` flattens errors to `stack || message` and strips CR/LF
  (`/\n|\r/g` + `""` — the ONLY form CodeQL models as a sanitizer; the
  `[\r\n]` + space form closed 0 of 25 alerts).
- blob: URLs are unwrapped in background.js `hostMatches` before parsing.

## External follow-ups

- **Felix:** (1) `firebase deploy --only functions` still pending for the
  ROUND-2 fixes (lookupCompany, geminiSearchHelper, precisionSearchQueue,
  gmailSyncQueue). Rounds 3 + #9 touched only app/ + lib/ + extension —
  Next.js auto-deploys from main, NO functions deploy needed for them.
  (2) `@fibukiapp/cli` 0.1.1 npm publish. Verify Stefan's batched ask.
- **Chrome Web Store:** manifest 0.0.3 (unchanged) ships on the next
  published GitHub Release.

## Guardrails (unchanged unless noted)

Port-never-regenerate; 6 GiB host — guard-memory hook, no full
vitest/tsc/next build; scoped typecheck now needs
`npx -y -p typescript tsc --noEmit --skipLibCheck --ignoreConfig <files>`
(repo node_modules is EMPTY; bare `npx tsc` serves a troll placeholder
package); PATH needs `~/.local/node/bin` + `~/.local/bin`; sub-agents OK
but ≤2 concurrent.
