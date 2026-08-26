# Migrating the fork's issues (upstream #98) — the plan, before anything is created

31 open on `yazzbert/FiBuKI-selfhost` as of 2026-08-26. This is the triage Stefan asked for:
re-evaluated, grouped, renamed into the upstream glossary, scrubbed. Nothing has been created
or closed yet — this file is the thing to approve or correct.

Result: **22 fork issues become 17 upstream issues, 6 close on the fork without travelling,
and 3 are held** because another agent has them in flight.

Fork numbers and upstream numbers collide (fork #149 and #150 are not upstream #149 and #150),
so every reference below says which repo it means.

---

## A. Close on the fork, do not migrate (6)

| Fork | Why it does not travel |
|---|---|
| #224 FREEZE: no new feature work on this fork | Meta. Dies with the fork. |
| #49 Meta: land the selfhost/fixes branch upstream as small PRs | That landing is what waves 1–6 were. Fulfilled; close with a pointer to #109–#153. |
| #214 ZAP Scan Baseline Report | Duplicate of upstream #50, which is open. |
| #51 J3: IMAP initial sync is never queued on self-host | **Verified fixed on `main`**: `functions/src/selfhost/imap-initial-sync.test.ts` exists and asserts `initialSyncStartedAt`. |
| #53 I2: one malformed timestamp takes down every page | **Verified on `main`**: PR #111 put every `toDate()` behind `toDateSafe`. The residual blind spots are already tracked as upstream #112 — close pointing there, do not open a second ticket. |
| #43 C3: no `delete_transaction` API | **Re-evaluated: this is by design, not a gap.** `CLAUDE.md` forbids individual Transaction deletion — a bank CSV that omits lines would let deletion create accounting inconsistencies. `deleteTransactionsBySource` is the sanctioned path and it exists. Close with the doctrine, and say so on the fork so it is not re-filed. |

### One that looked closable and is not

**Fork #52 (K1: FieldValue sentinels silently discarded under minification) is NOT fixed
upstream**, despite its "(SOLVED on the fork)" title. On `origin/main`,
`functions/src/selfhost/firestore-shim.ts:364` still identifies sentinels by
`constructor.name`:

```js
const name = (v as object).constructor?.name || "";
if (name.includes("ServerTimestamp")) return "serverTimestamp";
```

Felix's own fix, upstream PR #90, is **still open**. So #52 migrates (see B1) rather than
closing. This is exactly the case the brief warned about: three issues claimed "SOLVED on the
fork", two were, one was not.

---

## B. Held — another agent has these in flight (3)

Not migrated in this pass, so the titles and scope reflect the fixed state rather than the
filed state.

- fork **#229** — the § 11 classifier never checks the recipient is the User.
- fork **#233** — invoice direction has no review flag, filter or editor.
- fork **#232** — identity name matching is substring-only. Held with #233 because it *is* the
  mechanism behind #233's undirected Files; migrating it separately would file half a bug.

---

## C. Migrate (22 fork issues → 17 upstream issues)

Titles are written in the glossary (`CONTEXT.md`): **File**, **Partner**, **Invoicing Agent**,
**Extraction**, **Line Item**, **Rate Group**, **Match**, **Rejection**, **Confidence**,
**No-document Category**, **Documentation State**. They name the concept, not the incident.

### Grouped (4 groups, from 9 fork issues)

**B1 — one issue, from fork #52**
> *Self-host identifies FieldValue sentinels by constructor name, which minification erases*

Not strictly a group, listed here because it needs a body that points at PR #90 rather than
re-describing the bug Felix already wrote up.

**B2 — from fork #150 + #230**
> *Extraction attributes a multi-party document to the wrong party: the Invoicing Agent is read as the Partner, and the recipient is read from the wrong name block*

One defect with two faces. The glossary already settles the rule (ADR-0003: the Partner is the
Leistungserbringer; an Invoicing Agent is never a Partner), so the issue can state the expected
behaviour instead of arguing it. **Scrub:** the fork bodies name a real platform's template and
quote row counts from the live corpus.

**B3 — from fork #37 + #38 + #39 + #40**
> *Self-host has no account lifecycle: no subscription record is created, AI features are gated on billing, admin identity has two disagreeing sources, and invites silently do nothing*

Four A-series tickets that are one story now that self-host is the only backend (see upstream
#71). Four checkboxes in one body, each keeping its own reproduction.

**B4 — from fork #160 + #227**
> *The Match assumes one File to one Transaction: a second copy of the same document and a split part-invoice both fail*

Duplicate copies (many Files, one document) and part-invoices (many Files summing to one
payment) are the same cardinality assumption seen from two sides. **Scrub:** both bodies quote
corpus counts.

### Individually (13)

| # | Upstream title | From |
|---|---|---|
| 1 | Extraction hard-fails on an escaped character the JSON repair cannot fix | fork #225 |
| 2 | A backfill silently skips Files: some are written and some are not, on byte-identical inputs | fork #231 |
| 3 | The UVA has no MCP tool, so an agent cannot read the figures it helped produce | fork #42 |
| 4 | Extraction has no seam for pre-extracted text or pre-rendered pages, so a local model cannot be used | fork #46 |
| 5 | Partner assignments made before the scorer fix are never re-matched, and the obvious cleanup poisons the data | fork #86 |
| 6 | Assigning a No-document Category over MCP teaches nothing: Learned Patterns have no writer | fork #161 |
| 7 | The chase queue has no accepted receipt-only state, so a ruled-closed Transaction sits in the worklist forever | fork #228 |
| 8 | Parse the RKSV code on Austrian POS Receipts for a deterministic per-rate VAT split, with no model call | fork #226 |
| 9 | A dashed date column is read as DD-MM-YYYY only, so an MM-DD-YY bank export cannot be imported at all | fork #234 |
| 10 | Translation is wired but unused: the app is hardcoded English and the documents hardcoded German | fork #175 |
| 11 | A bank-paid reward row has no fitting No-document Category and gets no suggestion | fork #149 (fork) |
| 12 | The legacy vision parser returns no Line Items and no Rate Groups | fork #84 |
| 13 | Surface unreconciled Line Items and the printed Rate Group block | fork #83 |

Two notes on that table:

- **#5 (fork #86) cites "the #71 fix", meaning fork issue #71.** Upstream #71 is a different
  thing entirely (renaming the shim layer). The reference must be rewritten as prose, or it
  will point a reader at the wrong ticket. This is the one migration hazard that is not about
  data leakage.
- **#12 (fork #84) should be verified before it is filed.** If the legacy vision parser is dead
  code on `main`, the issue is "delete it", not "fix it".

---

## D. Scrubbing — the main risk of the exercise

Upstream is public. Fork bodies that carry live-corpus data, and what replaces it:

| Fork issue | What is in the body | Replacement |
|---|---|---|
| #225, #230 | `paperless-ap-NNNN` document anchors | "a document whose extraction fails on …", with the failing *shape* quoted, never the id |
| #231, #232 | corpus counts (7 of 81, 27% of files) | "a minority of Files, reproducibly" — the ratio adds nothing the mechanism does not |
| #160 | 30 of 110 unmatched files were second copies | the mechanism, no counts |
| #229 (held) | a real client name, a document id and its figures | rewritten to the general case before it goes anywhere |
| #149 (fork) | names a bank product | a bank product name is public, not user data — it stays, because it is the reproduction |

Precedent: `feedback_ported_commit_can_carry_instance_data`. There the leak was a whole
checked-in table; the same shape applies to an issue body.

Separately, and **not** created by this migration: `paperless-ap-NNNN` anchors are already
throughout upstream `main` from earlier waves. The migration makes that Stefan's decision
rather than a theoretical one, but it is not a blocker for the migration itself.

---

## E. Order of operations, once approved

1. Create the 17 upstream issues, each with a `Migrated from the self-host fork` line at the
   bottom and no fork link (the fork is public but is about to be archived).
2. Comment on each fork issue with its upstream number, then close it.
3. Close the 6 in section A with their reasons.
4. Comment on upstream #98 with the mapping table, and close it.
5. Leave the 3 held ones open on the fork; the agent holding them migrates them with the fix.
6. Archive the fork — **never delete** — only after #99 (repointing `fibuki.home.syh.at`),
   which is deliberately parked until Stefan's taxes are filed.
