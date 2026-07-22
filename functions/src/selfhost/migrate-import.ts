/**
 * W3 migration dump — importer (chunk 2). Runs against the SELFHOST stack and
 * never touches Firebase: it reads a version-1 dump directory (the contract in
 * dump-format.ts) and rebuilds it in the one tenant db/tenant.ts names.
 *
 * Two hard rules make the restore faithful:
 *  - Docs land through the ordinary shim write path —
 *    getFirestore().collection(path).doc(id).set(decoded) — never raw SQL, so
 *    flattened collections' generated/pushdown columns and canonical JSONB come
 *    out identical to organically-written data, and DocRef.set()'s upsert makes
 *    a re-run idempotent (no dedup logic here).
 *  - Users go through better-auth's provisionUser: uid-preserving, passwordless
 *    (migrated users get a forced reset, never a working credential), admin
 *    claim ported from the dump. provisionUser calls assertInvited for EVERY
 *    account, so we seed the allowedEmails invite gate first — otherwise even
 *    an admin fixture email is rejected before any adapter work.
 *
 * Storage import/verify is chunk 3 (migrate-import-storage.test.ts) — out of
 * scope here; dumps produced this chunk carry manifest.storage === null.
 *
 * Full seam + acceptance suite: migrate-import.test.ts. Brief:
 * handoffs/2026-07-22-w3-chunk2-migrate-import.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseManifest, type DumpManifest, type DocLine, type UserLine } from "./dump-format";
import { decodeWire, encodeWire } from "./wire-values";
import { getFirestore } from "./firestore-shim";
import { getAuth } from "./auth-shim";
import { createSelfhostAuth, type SelfhostAuth } from "./better-auth";

export interface ImportReport {
  dryRun: boolean;
  collections: { path: string; docs: number; written: number }[];
  users: { provisioned: string[]; existing: string[] };
  storage: { objects: number; written: number; bytes: number };
}

export interface VerifyReport {
  ok: boolean;
  collections: { path: string; expected: number; missing: string[]; mismatched: string[] }[];
  users: { expected: number; missing: string[] };
  storage: { expected: number; missing: string[]; checksumFailures: string[] };
}

/** One shared SelfhostAuth per process — provisionUser only, boot paid once. */
let authPromise: Promise<SelfhostAuth> | null = null;
function selfhostAuth(): Promise<SelfhostAuth> {
  return (authPromise ??= createSelfhostAuth());
}

// ---------------------------------------------------------------------------
// Dump IO
// ---------------------------------------------------------------------------

async function readManifest(dir: string): Promise<DumpManifest> {
  const raw = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
  return parseManifest(JSON.parse(raw));
}

/** One JSON object per non-blank line. */
async function readNdjson<T>(file: string): Promise<T[]> {
  const raw = await fs.readFile(file, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

async function readCollection(dir: string, file: string): Promise<DocLine[]> {
  return readNdjson<DocLine>(path.join(dir, "collections", file));
}

async function readUsers(dir: string, manifest: DumpManifest): Promise<UserLine[]> {
  if (!manifest.users) return [];
  return readNdjson<UserLine>(path.join(dir, manifest.users.file));
}

// ---------------------------------------------------------------------------
// Comparison — verify works in wire space: the dump's DocLine.data is already
// wire-tagged, and encodeWire() maps a stored doc (Timestamp instances and all)
// back to the same tagged shape, so a canonical-JSON compare is exact.
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** True if a user with this uid already exists in the target auth store. */
async function userExists(uid: string): Promise<boolean> {
  try {
    await getAuth().getUser(uid);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") return false;
    throw err;
  }
}

/**
 * Seed the invite gate for this email if it isn't already present.
 * provisionUser -> assertInvited queries allowedEmails with the normalized
 * (trim+lowercase) email, so we store the normalized form and match on it.
 */
async function seedInviteGate(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const existing = await getFirestore()
    .collection("allowedEmails")
    .where("email", "==", normalized)
    .limit(1)
    .get();
  if (existing.empty) {
    await getFirestore().collection("allowedEmails").add({ email: normalized, createdAt: new Date() });
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importDump(opts: { dir: string; dryRun?: boolean }): Promise<ImportReport> {
  const dryRun = opts.dryRun === true;
  const manifest = await readManifest(opts.dir);

  const collections: ImportReport["collections"] = [];
  for (const entry of manifest.collections) {
    const lines = await readCollection(opts.dir, entry.file);
    if (!dryRun) {
      for (const line of lines) {
        const data = decodeWire(line.data, false) as Record<string, unknown>;
        await getFirestore().collection(entry.path).doc(line.id).set(data);
      }
    }
    collections.push({ path: entry.path, docs: lines.length, written: dryRun ? 0 : lines.length });
  }

  const provisioned: string[] = [];
  const existing: string[] = [];
  for (const user of await readUsers(opts.dir, manifest)) {
    if (await userExists(user.uid)) {
      existing.push(user.uid);
      continue;
    }
    // Not present -> would be / is provisioned. dryRun classifies (a read)
    // but performs no writes.
    if (!dryRun) {
      await seedInviteGate(user.email);
      const auth = await selfhostAuth();
      await auth.provisionUser({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        admin: user.admin === true,
      });
    }
    provisioned.push(user.uid);
  }

  // Storage is chunk 3 — dumps this chunk produce have manifest.storage null.
  const storage = {
    objects: manifest.storage?.count ?? 0,
    written: 0,
    bytes: manifest.storage?.bytes ?? 0,
  };

  return { dryRun, collections, users: { provisioned, existing }, storage };
}

// ---------------------------------------------------------------------------
// Verify — proves every dump entry exists in the target and matches. Does NOT
// assert the target holds nothing else: the compose CI Postgres is shared
// across suites, so unrelated docs in the same tenant are expected.
// ---------------------------------------------------------------------------

export async function verifyDump(opts: { dir: string }): Promise<VerifyReport> {
  const manifest = await readManifest(opts.dir);

  const collections: VerifyReport["collections"] = [];
  for (const entry of manifest.collections) {
    const lines = await readCollection(opts.dir, entry.file);
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const line of lines) {
      const snap = await getFirestore().collection(entry.path).doc(line.id).get();
      if (!snap.exists) {
        missing.push(line.id);
        continue;
      }
      // Both sides in wire space: dump data is already tagged; encodeWire maps
      // the stored doc's Timestamp instances back to the same tags.
      if (!deepEqual(encodeWire(snap.data()), line.data)) {
        mismatched.push(line.id);
      }
    }
    collections.push({ path: entry.path, expected: lines.length, missing, mismatched });
  }

  const users = await readUsers(opts.dir, manifest);
  const usersMissing: string[] = [];
  for (const user of users) {
    if (!(await userExists(user.uid))) usersMissing.push(user.uid);
  }

  // Storage verify is chunk 3; dumps this chunk carry no storage section.
  const storage = { expected: manifest.storage?.count ?? 0, missing: [] as string[], checksumFailures: [] as string[] };

  const ok =
    collections.every((c) => c.missing.length === 0 && c.mismatched.length === 0) &&
    usersMissing.length === 0 &&
    storage.missing.length === 0 &&
    storage.checksumFailures.length === 0;

  return { ok, collections, users: { expected: users.length, missing: usersMissing }, storage };
}
