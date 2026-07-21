# CodeQL round 3 — bulk mediums: url-substring ×26, log-injection ×25

**Status:** continues `2026-07-21-codeql-round-2-outcome.md`. Round 2 is
done: PR #8 merged (24 alerts fixed), #295/#85/#86 dismissed. Prompt
ownership (option a, closes #35/#36) is **PR #9** — if still open when
this session starts, it can merge independently; don't rebase this
round's work on it. After #9 merges the open security backlog is exactly
the 51 bulk mediums below. Quality noise ×166 stays parked pending
Stefan's suite decision.

## Session start checks

```bash
gh pr view 9 --json state          # merged? then #35/#36 should show fixed
gh api "repos/yazzbert/FiBuKI-selfhost/code-scanning/alerts?state=open&per_page=100" \
  --paginate --jq '.[] | select(.rule.security_severity_level != null) | [.number, .rule.id, .most_recent_instance.location.path, .most_recent_instance.location.start_line] | @tsv'
```

Branch off `main` (pull `fork` first), PR to `main`.

## Task 1: incomplete-url-substring-sanitization ×26 (#40–#65)

Files: extension `content.js` ×18, `background.js` ×6, `dev-extractor.js`
:10, `lib/url-utils.js` :16 — plus `hooks/use-browser-learn-mode.ts` :197.

Fix pattern — per-file helper, then swap `.includes("host")` /
`.indexOf("host") !== -1` call sites:

```js
function hostMatches(url, host) {
  try {
    var h = new URL(url).hostname.toLowerCase();
    return h === host || h.endsWith("." + host);
  } catch (e) { return false; }
}
```

Cautions:
- These are download/billing-page heuristics (e.g. `payments.google.com`
  + `apis-secure/doc`); keep the non-host part of each condition (path or
  query substring checks on `url` are fine — only the host check moves
  into `hostMatches`).
- Some call sites receive relative URLs or already-lowercased strings —
  read each site, don't regex-replace blindly.
- `url-utils.js` is unit-tested (`tests/` or extension lib tests — check),
  update tests alongside.
- **Manifest:** 0.0.3 has not shipped to Chrome Web Store unless a GitHub
  Release was published since 2026-07-21. If unreleased, stay on 0.0.3;
  if a release went out, bump to 0.0.4 (RELEASING.md).

## Task 2: log-injection ×25

Alert sites (numbers may shift if earlier lines change; re-query at start):
`app/api/worker/route.ts` ×10, `app/api/gmail/*` (attachment ×2, callback,
pause, refresh), `app/api/banking/finapi-*` ×3, `app/api/truelayer/accounts`
×2, `app/api/chat/route.ts` :289, `app/api/precision-search/trigger` :94,
`lib/finapi/client.ts` ×2, `lib/agent/worker-graph.ts` ×2.

Fix pattern CodeQL accepts: strip CR/LF from tainted values before
interpolation — `String(x).replace(/[\r\n]/g, " ")` — or log the value as
a `%s`/`%o` argument / `JSON.stringify(x)`. Round 1 lesson: %s/%d args
were accepted for format-string alerts. Prefer a tiny local
`sanitizeForLog()` per file over a cross-module import (no refactors
beyond fixes). Don't change log semantics — same message, same level.

## Task 3 (Stefan decisions, don't start without him)

- Quality noise ×166: unused-local ×147, useless-assignment ×8,
  trivial-conditional ×8, misc ×3. Either a dedicated cleanup round or
  switch the CodeQL suite from `security-and-quality` to
  `security-extended` and let them close. Stefan picks.
- If suite stays, unused-local in generated/ported code may warrant
  path-based exclusion — also Stefan's call.

## External follow-ups (unchanged)

- **Felix:** (1) `firebase deploy --only functions` for the merged round-2
  fixes (lookupCompany, geminiSearchHelper, precisionSearchQueue,
  gmailSyncQueue — full functions deploy, modules are bundled widely);
  (2) `@fibukiapp/cli` 0.1.1 npm publish. Stefan was drafting the batched
  ask at round-2 session end — verify it went out / got done.
- **Chrome Web Store:** 0.0.3 ships on next published GitHub Release.

## Lessons from round 2 (on top of rounds 0–1)

- The fixpoint-loop strip pattern IS accepted by CodeQL — all 12
  sanitization alerts closed on the PR branch. Verify fixes on the branch
  analysis before merge: `alerts?ref=refs/heads/<branch>&state=open`.
- Alert numbers did NOT re-key this round (net line deltas above the
  flagged sites were zero) — but always re-query before dismissing.
- Remote layout: push via `fork` (GitHub); `origin` is a root-owned
  /opt/fibuki deploy checkout — never push there. `gh repo set-default`
  is configured now.
- No firebase CLI on this box, by design — functions deploys are Felix's;
  don't propose installing prod creds here.
- Scoped typecheck trick: `npx tsc --noEmit --skipLibCheck` on explicit
  files, filter `TS2307|TS2792` (module-resolution noise outside the
  project tsconfig); `node --check` for extension JS.
- Unanchored email/host regexes can still be quadratic-by-restart even
  when unambiguous — cap input length at the boundary (the 1 KB From cap).

## Guardrails

Unchanged: port-never-regenerate; 6 GiB host — guard-memory hook, no
parallel sub-agents, no full vitest/tsc/next build; PATH needs
`~/.local/node/bin` + `~/.local/bin`; classifier blocks push/dismissal —
end with paste blocks for Stefan. No global rule disabling without Stefan.
