# #189 — the live-connection hardening: DONE (outcome record)

Shipped 2026-08-27. The last code slice of the #185 replay epic is on both lineages:
the deployment branch (yazzbert/FiBuKI-selfhost#238, merge commit `5222f397`) and the
trunk (felixtosh/FiBuKI#196, squashed as `e21ff5db`). Both PRs were CI-green across the
full 7-job matrix plus CodeQL before merge; merged on Stefan's explicit go-ahead, with
#93's standing waiver of per-PR Felix review still in force (verified open at merge time).

`felixtosh/FiBuKI#189` is closed by hand — a cross-repo `Closes` links but never closes.

## What landed

Three real defects, each found on the retired deployment and never carried to the trunk.
**Every Self-host user had these.**

- **The change stream could stop reconnecting, silently.** A reconnect loop only runs
  when the previous attempt *finishes*, and two states finish neither way: a parked
  `await reader.read()` on a half-open connection (a dropped upstream held open
  downstream), and a `fetch` whose response headers never arrive. Neither raises, neither
  changes state, neither appears in an access log. It showed as gaps of 3 to 24 minutes
  with no stream and no reconnect attempt, during which every `onSnapshot` fell back to
  full-speed polling — which is how a realtime feature became a request-volume problem.
  Both waits are now bounded against the server's 25s heartbeat, and the watchdog calls
  **both** `abort()` and `cancel()`: `abort()` releases the socket, `cancel()` is what
  actually settles the parked read.
- **The poll bus answered one upload with hundreds of requests.** A poke costs one request
  *per listener* and the stream pokes on every change frame, so one upload cascading
  through extraction, partner matching and transaction matching hit a ~30-listener tab
  hundreds of times in seconds. Now leading-edge immediate (a user's own action must not
  wait on a timer) with a 400ms coalescing window and a trailing fan-out, so the last
  change in a burst is always refetched.
- **The limiter fired invisibly, and the data plane's cap was too low.** Cap `1000` to
  `6000` because **the shim tripped its own limiter** — 2.5s default poll times tens of
  listeners puts an idle tab in the high hundreds per minute, and the bucket is keyed by IP
  behind a proxy, so one busy tab exhausted it for every other client. Plus a plane label,
  one log line per plane per window, and a 429 body in the JSON shape the clients actually
  parse (the default handler answers plain text, which every client discards for
  `statusText` — empty on HTTP/2).

Five tests carried (lifecycle 4, watchdog 4, coalesce 6, rate-limit 5) and a UVA regression
over Q1+Q2 2026 (20).

## The two things the ticket did not anticipate

**The existing poll-bus tests needed a companion change.** `poll-bus.test.ts` and
`change-stream-client.test.ts` sit on the branch in their *trunk* versions. The coalescing
window is module state, so without a `__resetPokeWindow()` hook in `beforeEach`, one case
inherits the previous case's trailing fan-out and fails for the wrong reason. Both carried.

**The corpus-anchor guard failed on the carried UVA test** — 7 references across 3 of the
operator's private document ids. Renamed to `f-insurance-11pct`, `f-discount-to-zero` and
`f-multi-rate-meal`, plus the transaction ids derived from them and a `partnerName` that
spelled a FiBu reference with a space.

## The replay hazard, stated once so it is not re-derived

`stefan-prod` is frozen at tag `retired/stefan-prod-2026-08-27`; the trunk kept moving. Any
file both lineages touched has some lines where prod is newer and some where **the trunk**
is. Copying prod's whole file takes both, and the stale half silently reverts trunk work.
Per file, before carrying:

```bash
git diff origin/main retired/stefan-prod-2026-08-27 -- <file>
```

`-` lines are what a whole-file copy would **delete**. Six of the seven files here were
safe in-place replacements. One was not: **`storage-routes.ts`** would have reintroduced
CodeQL `js/remote-property-injection` alert #283, which the trunk deliberately closed in
#181 by replacing the `customMetadata[k] = String(v)` sink with a `Map`. It took the
`makeRateLimiter(600, "blob")` line and nothing else.

A file-presence check reports all seven as already done, because they exist on the branch
in their trunk versions. Do not trust one.

Verified on both refs *after* the merges rather than trusting them: 5/5 tests present, the
6000 cap, the `"blob"` label, and `Object.fromEntries(collected)` still intact.

## Left open, deliberately

- **#195 (`payableAmount`)** is the only code slice left in #185. Once it lands the replay
  is complete and the deployment can cut over in the homelab repo.
- **#198** — filed off this work. `scripts/check-corpus-anchors.js` builds its FiBu pattern
  as `["FIBU", "\\d{8}"].join("_")`, so the separator is hard-coded to an underscore and a
  reference written with a **space** passes clean. One is on `main` right now:
  `functions/src/uva/nonClaimableVat.test.ts:63` carries `partnerName: "FIBU 20260109-8624"`,
  and the guard reports "No corpus anchors found" on that tree. This corrects
  `2026-08-26-post-migration-brief.md`, which records the Paperless-anchor question as
  answered — the fixtures were fixed, but the guard has a gap and it is the guard that
  people act on. Fix the pattern first, then the fixture, and check whether the Paperless
  and invoice patterns share the assumption.
- **Sandcastle stays paused** at Stefan's instruction, until Self-host is fully pointed at
  the trunk. Config in `../fibuki-sandcastle` is already repointed (tickets from
  `felixtosh/FiBuKI`, base `deploy/2026-08-27`). It fails at 3-way parallelism on the Mac —
  `npm ci` over virtiofs exceeds the 600s hook timeout — so `npm run smoke -- <n>` (single
  sandbox) if a run is ever wanted. **Ask before starting one.**
- **#200 — a `js/log-injection` alert this carry INTRODUCED.** CodeQL #297, open on `main`
  at `rate-limit.ts:45`: the new `console.warn` interpolates `req.ip`, `req.method` and
  `req.originalUrl`, and `originalUrl` is not newline-stripped, so an encoded CR/LF in a
  request path forges log lines. Created 16:26 UTC when #196 was first analysed. The code
  came from `stefan-prod`, where it had never been CodeQL-scanned.

  Worth stating plainly rather than burying: the hazard analysis here was scoped to files
  where prod and trunk **conflicted**, and it worked — alert #283 stayed fixed, zero open
  `remote-property-injection` on `main`. But a clean-carry file with no conflict brought a
  different sink in unexamined. **A carry needs a security read of what it ADDS, not only of
  what it would overwrite.** Apply that to #195 before carrying it.

- **Cutover script** `deploy/selfhost/cutover-to-apex.sh` is *not* carried and never will
  be here. Self-host deployment lives in the operator's homelab repo.

## Operational notes for the next session

- **Remote names in this clone are the reverse of the usual FiBuKI handoff.** `origin` is
  **felixtosh/FiBuKI (the trunk)** and `fork` is **yazzbert/FiBuKI-selfhost**. Local `main`
  tracks `origin/main` but sits on `fork/main`'s commit — so a bare `git push` on `main`
  aims at the **trunk**. Name the remote explicitly for docs commits.
- **`gh` PR and issue creation on felixtosh/FiBuKI 403s** under the default fine-grained
  PAT, which can push but not create. Stefan's decision (2026-08-27) is to accept that
  routing rather than widen the token: `source ~/.secrets/github-classic.env` and prefix
  with `GH_TOKEN="$GH_CLASSIC_TOKEN"`. Expect it, don't hand the task back.
- **The memory-guard hook matches on literal command text**, so a shell command merely
  *containing* the blocked strings — inside a `grep`, a heredoc, a PR body — gets blocked as
  if it were a full run. This record could not be written with a heredoc for that reason.
  Work around it with globs, a body file, or the Write tool.
- Scoped runs for this area: `cd functions && npx vitest run <file> --pool=forks
  --maxWorkers=1`. Note `src/uva/**` runs under the **default** config while
  `src/selfhost/**` needs `--config vitest.selfhost.config.ts` — the default config
  excludes `src/selfhost/**` outright.
