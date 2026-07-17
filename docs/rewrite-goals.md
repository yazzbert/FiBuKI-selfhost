# FiBuKI rebuild — goals and constraints

> **Status:** Agreed 2026-07-17 by Felix and Stefan. Supersedes the "move to
> Supabase" idea. Read [`who-is-this-for.md`](./who-is-this-for.md) first — the
> product focus is what justifies all of this.

## The goal in one paragraph

Take FiBuKI off Firebase and onto a stack with no vendor in it, so that the same
codebase runs as a cloud product we host and charge for, and as an open-source
product anyone can run themselves. Self-host and cloud are the **same code with
different config** — not two products, not two branches.

## The one architectural idea

**Self-host is multi-tenant with one tenant.**

Same schema, same `tenant_id` column, same enforcement path. Self-host just always
has exactly one tenant. There is no second code path, no `if (selfHosted)` branch
in business logic. If you find yourself writing one, the design is wrong.

This only works because **we own the API layer**. The client never talks to the
database. That single decision is what makes the database, storage, auth, and
deployment topology swappable underneath. It is load-bearing — protect it.

## Port, not rewrite

This is the constraint most likely to be violated, so it goes near the top.

**The domain logic is the company.** The matching engine, extraction, BMD export,
capital-gains logic, reconciliation — that's years of edge cases discovered from
real Austrian accounting data, most of which are documented nowhere except in the
code. Firebase coupling is not the company.

- **Port** the infrastructure. Replace the coupling.
- **Refactor** domain logic where Postgres makes it simpler (a lot of the matching
  engine exists *because* Firestore can't join — that code should shrink).
- **Never regenerate** domain logic from scratch, with an LLM or otherwise.

The proof this works already exists: the `selfhost/spike` branch runs FiBuKI on
Postgres with **98 frontend files importing `firebase/*` completely unmodified**.
The infrastructure came out without the domain logic moving. That's the whole
thesis, already demonstrated.

### On using an LLM for this

LLMs make writing code cheap. They do not make *knowing what the code should do*
cheap. Use one for the mechanical transformation — Firestore calls to Drizzle
queries — which is exactly what they're good at and which tests can verify. Do not
use one to regenerate logic that has no tests. It will produce confident, plausible
code that's subtly wrong on the edge cases nobody wrote down.

**Tests first. Then the LLM.** Not negotiable — see Phase 0.

## The stack

| Layer | Choice | Why | Escape hatch |
|---|---|---|---|
| **DB** | Postgres, plain | The data is relational. Firestore was always the wrong fit. | Any Postgres: local, RDS, Neon, Supabase |
| **Query** | Drizzle | TS-native, migrations are readable SQL, no engine binary | It's just SQL |
| **API** | Hono on Node 22 | Light, portable across runtimes | Plain HTTP |
| **Auth** | Better Auth, OIDC pluggable | Lives in the app, stores in our Postgres, **no auth container**. Org plugin gives multi-tenancy primitives. | OIDC means self-hosters can plug Authentik/Keycloak/Entra |
| **Storage** | S3 API | MinIO or Garage self-host, any S3 in cloud | The API *is* the abstraction |
| **Jobs** | pg-boss | Postgres-backed queue. **No Redis.** Transactional with the data. | Graphile Worker |
| **Realtime** | ElectricSQL | Apache-2.0, one container, reads the WAL, syncs reads. Writes still go through our API. | LISTEN/NOTIFY + own WebSocket |
| **AI** | Provider interface | Same pattern as the existing MailProvider seam | BYO key, or local Ollama |

Result: `docker compose up` gives you postgres, storage, app, electric. **Four
containers, whole product.**

### Why not Supabase

Supabase's value is PostgREST + RLS — the client talks to the DB directly, auth
enforced by row policies, thin API. FiBuKI is the opposite shape: ~112 callables of
real business logic. That logic does not go into row policies.

Using Supabase non-idiomatically (just hosted Postgres + auth + storage) means
paying vendor coupling for ~30% of the product. And going idiomatic costs more:
Edge Functions are Deno (a second runtime, which *breaks* the self-host/cloud
parity that's the entire point), and self-hosted Supabase is ~10 containers against
our four.

**Supabase remains a fine deploy target** — it's Postgres. It is not the
architecture.

### Realtime

ElectricSQL's recommended pattern is: sync reads through Electric, writes through
your own API. That's exactly FiBuKI's shape. It's a sync layer over Postgres we
already own, not a framework we build into — remove it and we're back to polling,
nothing else breaks.

It's also strictly better than what Firestore gave us: `onSnapshot` was
server-push, Electric gives local-first and offline-capable. For a tool people use
on bad café wifi, "works offline, syncs later" is a product feature.

**Risk:** Electric is young and has had a v1 rewrite. Mitigated by it being
read-sync only, with polling as a proven fallback (we're running it today).

## Multi-tenancy

**Shared schema, `tenant_id` on every table, API enforces, RLS as backstop.**

RLS is not the mechanism — we own the API, so that's the enforcement point. But
for tax data, where a cross-tenant leak is existential, RLS is a seatbelt worth
wearing: `set local app.tenant_id` per transaction, policies as defense in depth.
Drizzle supports it.

Schema-per-tenant and DB-per-tenant both look tempting and both bite at migration
time. Don't.

## The cloud/self-host split

**Same features. Different effort.** This is a rule, not a guideline.

| | Self-host | Cloud |
|---|---|---|
| Features | All of them | All of them |
| OAuth apps | Bring your own | We did the verification + CASA |
| Bank connections | Your finAPI contract | Ours |
| AI models | Your key, or local Ollama | Included |
| Compliance | Yours | Ours |

The moat is real work already done (see `docs/casa/`), not a crippled build. Any
proposal to gate a *capability* behind the cloud tier violates this and should be
rejected.

The existing **IMAP provider is core to this**, not a side feature: self-hosters
can't realistically get Gmail `gmail.readonly` verified (restricted scope, Google
security review, CASA assessment). IMAP is the open-source ingest path.

## License

**AGPL-3.0 + CLA.**

- AGPL stops someone hosting FiBuKI-as-a-service against us.
- The CLA lets us dual-license: sell a commercial license to anyone whose legal
  department won't touch AGPL, and keep cloud-only infrastructure proprietary.

**The CLA must be in place before the first external contributor.** Without it we
can never relicense without tracking down every contributor for sign-off. This is
the only decision here with a hard expiry.

## Phases

Each phase ships independently. No flag day.

### Phase 0 — safety net (before any port work)

This phase is the whole argument. Everything after it is unsafe without it.

- **Characterization tests on domain logic** — capture what it does *today*, bugs
  included. Priority order: **BMD export first** (it's the trust gate with the
  Steuerberater), then the matching engine, then extraction.
- **Wire the selfhost suite into CI.** 135 tests exist and nothing runs them — no
  npm script, the invocation lives only in a comment at
  `functions/vitest.selfhost.config.ts:6`. Add `test:selfhost` + a CI job.
- **Compose-backed CI job** running the same suite against **real Postgres and real
  S3**. Today tests use PGlite and in-memory storage; the production branches
  (`firestore-shim.ts:46-59` for `pg.Pool`, the MinIO client path) are executed by
  zero tests. The suite is already backend-agnostic, so this is nearly free.
- **Firestore-API parity test** — same assertions against real `firebase-admin` and
  against the shim. Today the shim is only asserted against its own intended
  behavior. **Scope it from the app's call sites, not from the shim** — see the
  correction below; this is the single easiest thing to get subtly wrong.
- **License + CLA.**

#### Parity-test scope: derive it from the app, never from the shim

A first pass at `functions/src/test/firestore-parity.test.ts` (branch
`phase-0-tests`, 2026-07-17) got the hard parts right — same assertions against both
backends, real `firebase-admin` against the Firestore emulator, wired into CI via
`emulators:exec`, and a KNOWN DIVERGENCE mechanism pinning both behaviors where the
two legitimately differ. Then its header said:

> Scope: exactly the API surface the shim implements (which mirrors what the app
> uses). Anything the shim does not implement (startAfter, onSnapshot, …) is
> deliberately NOT asserted here.

**That scope is circular and defeats the test.** A parity suite bounded by what the
shim implements cannot discover what the shim is *missing* — it lands back at the
shim asserted against itself, with more machinery. And the parenthetical was false:
the app *does* use `startAfter` (`tools/handlers.ts:228`,
`precision-search/precisionSearchQueue.ts:1953`), which is the live throwing defect
recorded above. The gap was found, reported, and then carved out of the one test
whose job was to catch it.

**The rule:** the tested surface is derived from **what the app calls** — greppable,
a fact about the codebase, not a judgment call. A method the app uses and the shim
lacks must produce a **red test**. That red is the deliverable, not a problem to
scope around.

Every exclusion needs a real call-site check, not an assumption. `undefined-value
rejection` and `query-limit enforcement` were excluded on the same reasoning and
deserve the same audit — those two diverge *silently* and corrupt data rather than
throwing, which is worse than the cursor bug.

Generalizes past this test: the shim's value proposition **is** Firestore-API parity.
Any check scoped by the shim's own surface is measuring the shim against itself.

Known coverage gaps to close: all 61 `app/api/*` routes (zero tests, no runner at
repo root), `gmailSyncQueue.ts:244-307` (the provider fork), and
`lib/selfhost/auth-client.ts` (858 LOC, zero tests).

**Live shim gap — cursors (found 2026-07-17, CT 999):** `firestore-shim.ts` implements
no `startAfter` / `startAt` / `endBefore`, but two server paths call `.startAfter()`:
`functions/src/tools/handlers.ts:228` (the MCP/API tool registry) and
`functions/src/precision-search/precisionSearchQueue.ts:1953`. Under selfhost these
**throw**, they don't degrade. Neither file has tests, which is why nothing caught it.

This is not a Phase 1 nice-to-have — it's a defect in the deployment running on CT 999
today, latent only because those paths are unexercised there. It is also the exact
class of bug a Firestore-API-parity test exists to catch: the shim was asserted against
its own intended behavior, and the real SDK's surface was never diffed against it.
Treat it as Phase 0 evidence, and add cursor support in Phase 1's SQL pushdown work
(a JSONB scan + JS filter can't express a cursor efficiently anyway).

### Phase 1 — schema

Drizzle, `tenant_id`, flatten collections **behind the existing shim interface**.
The shim is the migration harness — that's its entire purpose. Collection by
collection, app code doesn't notice. Delete matching-engine code that Postgres
makes redundant.

The current shim stores docs as JSONB in one `docs` table and filters **in JS**
(`firestore-shim.ts:447`). Fine for one user. **Fatal for multi-tenant** — no
indexes, no pushdown. It is a bridge, not a destination.

### Phase 2 — rip the shim

Remove the Firestore API surface entirely. Better Auth + migration of existing
fibuki.com users off Firebase Auth (identity mapping, password reset or OAuth
re-link — real work, don't hand-wave it).

### Phase 3 — the new capabilities

Electric (realtime), pg-boss (retire the Firestore-collection queue + node-cron),
cloud tier, billing.

## Deployment during the transition

New version ships to a **subdomain** (`new.fibuki.com`), not a path
(`fibuki.com/new`). Path-routing two auth systems on one origin means shared cookie
scope, CSP knots, and a real security surface. A subdomain gives clean isolation
for free.

Be honest about which pattern this is: if the new version has separate data, it's a
v2 with a migration cliff, not a strangler fig. That's a legitimate choice — but
name it, because it determines whether dual-write is needed.

## What this does not fix

Stated plainly so nobody mistakes the rebuild for progress on the business:

**The stack was never the bottleneck.** No customer will ever notice it. The
competition (BMD, sevDesk, lexoffice, FreeFinance) doesn't lose deals over their
database — they compete on tax-compliance depth and Steuerberater trust.

The rebuild is justified by three things and no others:

1. **You cannot open-source on Firebase.** Nobody can `git clone && docker compose
   up` against a Firebase project. The open-source goal is impossible without it.
2. **Firestore can't join.** Postgres lets us delete code.
3. **Firebase cost curves** on a read-heavy accounting app are a margin problem.

Those are sufficient. "The new stack is better" is not. Don't let the rebuild
become the thing we do instead of finding customers.
</content>
</invoke>
