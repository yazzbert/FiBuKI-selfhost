# CodeQL backlog round 2 — 247 open / 81 security-severity (2026-07-21 snapshot)

**Status:** continues `2026-07-20-codeql-backlog.md`. Round 1 is done:
PRs #3–#7 merged, 16 alerts fixed, 3 dismissed (#33/#81/#82), publish
workflow gated on token presence. Whether round 2 runs before or after the
transactions flatten (`2026-07-20-phase-1-flatten-transactions.md`) is
Stefan's call — round 1 covered everything critical.

## Immediate: one leftover dismissal

`#295 js/http-to-file-access cli/lib/auth.mjs:164` — the old by-design #87
re-surfaced under a new number because the fix moved the flagged line
(alerts are location-keyed). Same rationale, Stefan runs:

```bash
gh api -X PATCH "repos/yazzbert/FiBuKI-selfhost/code-scanning/alerts/295" \
  -f state=dismissed -f dismissed_reason="won't fix" \
  -f dismissed_comment="By design: saving the issued API key to ~/.fibuki/config.json is the auth command's purpose (like gh auth login). Written with mode 0600 (PR #3). Same rationale as former alert #87, re-keyed after the line moved."
```

## Priority order

1. **system-prompt-injection ×2 — decision needed first** (#35
   `app/api/agent/route.ts:72`, #36 `app/api/chat/route.ts:260`).
   Analysis from round 1: client-sent `role:"system"` messages *replace*
   the server's SYSTEM_PROMPT — chat route only unshifts its own when none
   present (`app/api/chat/route.ts:295-297`), and the agent route
   round-trips system messages back to the client via serializeMessages.
   Options: (a) server always owns the prompt, drop client system roles —
   verify the UI never originates one (`components/chat/chat-provider.tsx`
   casts roles at 484/540/1045); (b) dismiss by-design (user "injecting"
   their own owner-scoped assistant). Ask Stefan before touching chat flow.
2. **Extension pass 2** (bump manifest past 0.0.2 if code changes;
   RELEASING.md applies): regex-anchor ×8 — #117–#122 are one block at
   `content.js:664-669`, #115/#116 at `lib/replay-engine.js:1512`;
   incomplete-url-scheme-check ×2 (#38 `content.js:1137`, #39 `:1881`);
   user-controlled-bypass ×2 (#85/#86 `content.js:836,877` — the
   login-page resume heuristic; likely by-design dismissal, it's UX flow
   control, not an auth gate).
3. **Server-side highs:** bad-tag-filter ×3 (#78 analyze-email route:204,
   #79 `lookupCompany.ts:107`, #80 `geminiSearchHelper.ts:203` — the last
   two are ported domain logic, port-never-regenerate caution);
   polynomial-redos ×2 (#83/#84 gmail attachment/convert-to-pdf routes);
   insecure-randomness #31 (`lib/operations/agentic-search-ops.ts:57`,
   Math.random — if it's a non-security ID, dismiss; if any auth/token
   role, switch to crypto.randomUUID).
4. **Bulk mediums:** incomplete-url-substring-sanitization ×26,
   log-injection ×25, incomplete-multi-character-sanitization ×9.
5. **Quality noise ×166** (unused-local ×147, useless-assignment ×8,
   trivial-conditional ×8, misc ×3) + the `security-extended` vs
   `security-and-quality` suite question — Stefan decision.

## External follow-ups (not code)

- **Felix owns the @fibukiapp npm scope** (see memory): npm still serves
  `@fibukiapp/cli@0.1.0` with the command-injection bug; 0.1.1 needs Felix
  to publish, add Stefan as maintainer, or provide a token for the
  `NPM_TOKEN` secret → then
  `gh workflow run publish-packages.yml -f publish_cli=true`.
- **Chrome Web Store:** extension 0.0.2 (sandbox hardening) ships only
  when a GitHub Release is published (RELEASING.md procedure).

## Lessons from round 1 (on top of round 0's)

- Classifier blocks `git push`, alert dismissal, and writing dismissal
  scripts to `~` — but `gh pr create`/`gh pr merge`/`git pull` are fine.
  End push-ready work with paste blocks for Stefan (memory:
  provide-push-commands).
- Don't pre-dismiss alerts a pending fix might close: #32/#87 flipped to
  "fixed" once the hardening merged — merge first, re-check, then dismiss
  what's left.
- Moving a flagged line re-keys the alert to a new number (#87 → #295).
- Fix patterns CodeQL accepted: encodeURIComponent at the sink (SSRF),
  %s/%d args instead of tainted format strings, source-check + typeof +
  hasOwnProperty + function-check for postMessage dispatch.
- TypeScript types are erased at runtime — check API boundaries for
  runtime validation even when parameters are typed (the bankConnectionId
  fix; CodeQL's taint analysis trusted the declared type too).

## Guardrails

Unchanged from round 1: port-never-regenerate for domain logic; suites
from `functions/` (`--pool=forks --maxWorkers=1`); app-side has no repo
test runner (CI covers lint/typecheck/build); 6 GiB host — guard-memory
hook, no parallel sub-agents, PATH needs `~/.local/node/bin` and
`~/.local/bin` (gh); branch off `main`, PR to `main`.

## Non-goals

No rewrite-phase work, no refactors beyond fixes, no global rule disabling
without Stefan.
