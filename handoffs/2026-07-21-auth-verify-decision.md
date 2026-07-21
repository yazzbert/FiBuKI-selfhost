# Auth findings: unverified JWT in API routes — Stefan decision needed

**Status:** Investigation complete 2026-07-21 (Task 1 of post-CodeQL follow-ups).
No code changed — the handoff said report before touching auth behavior.

## Finding: `getServerUserIdWithFallback` is an auth bypass in the Next.js API layer

`lib/auth/get-server-user.ts` decodes the Bearer JWT **without signature
verification** and returns `payload.user_id || payload.sub`. Anyone can mint a
three-part token with an arbitrary `user_id` — no Firebase account needed.
`isServerUserAdmin` reads `payload.admin === true` from the same unverified
payload, so the admin gate is equally forgeable.

The "fallback" in the name is historical: the original version fell back to a
mock `dev-user-123` in development. That fallback was already removed; the
unverified decode was always a "for now" placeholder that shipped.

## Blast radius (44 routes call it)

- **~23 routes do direct Firestore/Storage access via Admin SDK** (bypasses
  security rules) keyed on the forged userId → full cross-tenant read/write.
  Includes `chat` (agent with write tools), `worker`, all `banking/*`,
  most `gmail/*`, `browser/upload`, `sources/[id]/disconnect`,
  `precision-search/*`, `plaid/exchange`, `finapi/callback`,
  `mail/imap/connect`, `auth/device/approve`.
- **~15 routes use the server-side client SDK** (`getServerDb` /
  `firebase/firestore`) or lib helpers — same problem, subject only to
  whatever `firestore.rules` allows an unauthenticated server principal.
  Includes `email-inbound/*`, `truelayer/*`, `gmail/analyze-email`,
  `sources/delete-orphans`.
- **6 pure proxy routes** (`matching/score-files`, `reports/*`,
  `finanzonline/*`, `browser/convert-html`) forward the raw token to Cloud
  Functions, which verify it themselves — a forged token fails downstream.
  These are safe; the decoded userId is only a pre-check.
- **2 admin routes** (`admin/tests`, `admin/cleanup-orphaned-transactions`)
  are gated by the forgeable `admin` claim.

## Recommended fix (pending Stefan's go-ahead)

`firebase-admin` is already initialized with the service account in prod
(`lib/firebase/admin.ts`) and points at the auth emulator in dev
(`FIREBASE_AUTH_EMULATOR_HOST` is set at module load). So a drop-in exists:

```ts
import { getAuth } from "firebase-admin/auth";
const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
return decoded.uid; // and decoded.admin === true for the admin check
```

One helper change fixes all 44 routes; no per-route edits needed. Caveats:

- Self-host: `functions/src/selfhost/auth-shim.ts` deliberately throws on
  `verifyIdToken` (OIDC layer owns auth there). The helper needs the same
  branch point so the selfhost spike keeps working.
- Emulator tokens verify fine when the env var is set (already is).
- Adds one Google cert fetch (cached by the SDK) per cold start — negligible.

## Other open decisions (Tasks 3–4 from the fulfilled handoff)

- **Extension tests unwired:** `extensions/taxstudio-browser-tests/*.test.js`
  can't run anywhere — `require("../lib/url-utils")` doesn't resolve, jest
  config points at `./__tests__/`, jest not installed, no CI job. Pick: move
  tests back under the extension with a CWS-zip exclusion, or point
  rootDir/testMatch at the sibling dir and fix requires; either way add CI.
- **Quality noise ×166** (unused-local ×147, useless-assignment ×8,
  trivial-conditional ×8, misc ×3): dedicated cleanup round vs switching
  CodeQL suite `security-and-quality` → `security-extended`; if suite stays,
  consider path-based exclusion for generated/ported code.

## Still pending externally

- **Felix:** `firebase deploy --only functions` for ROUND-2 fixes
  (lookupCompany, geminiSearchHelper, precisionSearchQueue, gmailSyncQueue);
  `@fibukiapp/cli` 0.1.1 npm publish.
- **Chrome Web Store:** manifest 0.0.3 ships on next published GitHub Release.
