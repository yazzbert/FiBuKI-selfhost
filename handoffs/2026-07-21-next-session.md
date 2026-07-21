# Next session — security backlog CLOSED; pick up roadmap work

**Status:** All post-CodeQL work is done and merged 2026-07-21:
PR #11 (system-prompt ownership + receipt-gate fix), PR #12 (verifyIdToken —
the unverified-JWT auth bypass is fixed), PR #13 (extension jest suite wired
+ CI job), PR #14 (CodeQL suite → security-extended only). Outcome details in
`handoffs/2026-07-21-auth-verify-decision.md`.

## Session start checks

```bash
gh api "repos/yazzbert/FiBuKI-selfhost/code-scanning/alerts?state=open&per_page=100" \
  --paginate --jq 'length'
# expect 0 TOTAL now (suite switch retired the quality-only rules);
# if >0, investigate before anything else
```

Post-merge verification done 2026-07-21: the main analysis on `edfbcc4e` ran
with the reduced suite and open alerts dropped to **0 total** — the ×166
quality alerts auto-closed as predicted.

## What changed that's worth watching

- **Auth:** Next API routes now verify ID tokens (`lib/auth/get-server-user.ts`,
  Firebase Admin `verifyIdToken`). Expired/forged tokens that previously
  "worked" now 401/500. If users report auth errors after deploy, check
  Vercel-style logs for `[Auth] Token verification failed` — the frontend's
  `getIdToken()` auto-refreshes, so persistent failures mean a real problem.
  Function name `getServerUserIdWithFallback` was kept to avoid touching 44
  routes; the "fallback" is historical (rename is optional cleanup).
- **CI:** new `Extension (jest)` job runs the 67 extension tests on every PR.
- **CodeQL:** suite is `security-extended` only. Quality cleanup round is
  still possible later if wanted, but nothing tracks it.

## Workflow (unchanged)

Push branches yourself (`git push fork <branch>`); merge only on Stefan's
explicit "merge PR N". CI green → adversarial self-review → report → wait.
CodeQL per-PR check: `alerts?ref=refs/pull/<N>/merge` (branch refs return
empty). Delete fulfilled handoff prompts (this one included).

Scoped typecheck incantation that actually works on this box (guard hook
wants the memory flag in the command; tsc itself rejects it, so pass it via
NODE_OPTIONS; `--ignoreConfig` is required when listing files):

```bash
NODE_OPTIONS=--max-old-space-size=900 npx -y -p typescript tsc --noEmit --skipLibCheck --ignoreConfig <files>
```

## External follow-ups (unchanged, verify with Stefan)

- **Felix:** (1) `firebase deploy --only functions` still pending for the
  ROUND-2 fixes (lookupCompany, geminiSearchHelper, precisionSearchQueue,
  gmailSyncQueue). Everything since (rounds 3, #9, #11–#14) touched only
  app/ + lib/ + extension + workflows — auto-deployed from main, no functions
  deploy needed. (2) `@fibukiapp/cli` 0.1.1 npm publish.
- **Chrome Web Store:** manifest 0.0.3 ships on the next published GitHub
  Release.

## Next work

No security backlog remains. The active roadmap workstream has its own
prompt: `handoffs/2026-07-20-phase-1-flatten-transactions.md` (flatten
`transactions` → `files` → `partners` out of the JSONB bridge; scope
confirmed by Stefan 2026-07-20) — pick that up unless Stefan redirects.
Other candidate loose end if he wants it: the selfhost Next API-route story
(routes are Firebase-only; selfhost data plane is fibuki-api — decide
whether routes get an OIDC path or stay out of selfhost scope).

## Guardrails (unchanged)

Port-never-regenerate; 6 GiB host — guard-memory hook, no full
vitest/tsc/next build (full suites on CT 999); PATH needs
`~/.local/node/bin` + `~/.local/bin`; sub-agents OK but ≤2 concurrent;
no firebase CLI / prod creds on this box.
