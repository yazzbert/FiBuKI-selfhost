/**
 * Drop-in for `firebase-admin/auth` in the self-host build (W1 chunk 2):
 * the admin surface over the REAL Better Auth store. Reads and writes go
 * through the same shared SqlClient as all other IO (one tenant-scoped
 * app-role transaction per call, RLS armed); `verifyIdToken` delegates to
 * the Better Auth verifier (JWKS + session-liveness), so token revocation
 * semantics are identical to the host's.
 *
 * Error parity: firebase-admin consumers branch on `error.code` — lookups
 * for absent users throw `auth/user-not-found`, bad tokens throw
 * `auth/argument-error`, reserved claim names throw
 * `auth/forbidden-claim`.
 */

import { getSqlClient } from "./firestore-shim";
import { getTenantId } from "./db/tenant";
import { createSelfhostAuth, RESERVED_CLAIMS, type SelfhostAuth } from "./better-auth";

export interface UserRecord {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  disabled: boolean;
  customClaims: Record<string, unknown>;
  metadata: { creationTime: string; lastSignInTime: string };
}

export interface DecodedIdToken extends Record<string, unknown> {
  uid: string;
}

/** firebase-admin surfaces errors with a stable `code` — consumers branch on it. */
class AuthShimError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthShimError";
  }
}

type Row = Record<string, unknown>;

async function runSql(sql: string, params: unknown[]): Promise<{ rows: Row[] }> {
  const client = await getSqlClient();
  return client.tx(getTenantId(), (q) => q(sql, params));
}

/**
 * One shared SelfhostAuth per process for token verification. Lazy: most
 * shim consumers only do user lookups and never pay the Better Auth boot.
 */
let authPromise: Promise<SelfhostAuth> | null = null;
function selfhostAuth(): Promise<SelfhostAuth> {
  return (authPromise ??= createSelfhostAuth());
}

function iso(v: unknown): string {
  return (v instanceof Date ? v : new Date(String(v))).toISOString();
}

function parseStoredClaims(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Map an auth_users row (+ optional lastSignInAt aggregate) to a UserRecord. */
function toUserRecord(row: Row): UserRecord {
  return {
    uid: String(row.id),
    email: String(row.email),
    emailVerified: row.emailVerified === true,
    displayName: typeof row.name === "string" ? row.name : "",
    disabled: false,
    customClaims: parseStoredClaims(row.customClaims),
    metadata: {
      creationTime: iso(row.createdAt),
      lastSignInTime: iso(row.lastSignInAt ?? row.createdAt),
    },
  };
}

/** auth_users plus the newest session's createdAt as lastSignInAt. */
const USER_SELECT = `
  SELECT u.*,
         (SELECT max(s."createdAt") FROM auth_sessions s
           WHERE s.tenant_id = u.tenant_id AND s."userId" = u.id) AS "lastSignInAt"
    FROM auth_users u`;

class AuthShim {
  async getUser(uid: string): Promise<UserRecord> {
    const res = await runSql(`${USER_SELECT} WHERE u.tenant_id = $1 AND u.id = $2`, [
      getTenantId(),
      uid,
    ]);
    if (res.rows.length === 0) {
      throw new AuthShimError("auth/user-not-found", `selfhost auth: no user with uid ${uid}`);
    }
    return toUserRecord(res.rows[0]);
  }

  async getUserByEmail(email: string): Promise<UserRecord> {
    const res = await runSql(`${USER_SELECT} WHERE u.tenant_id = $1 AND u.email = $2`, [
      getTenantId(),
      email.trim().toLowerCase(),
    ]);
    if (res.rows.length === 0) {
      throw new AuthShimError("auth/user-not-found", `selfhost auth: no user with email ${email}`);
    }
    return toUserRecord(res.rows[0]);
  }

  async listUsers(maxResults = 1000): Promise<{ users: UserRecord[] }> {
    const res = await runSql(
      `${USER_SELECT} WHERE u.tenant_id = $1 ORDER BY u."createdAt", u.id LIMIT $2`,
      [getTenantId(), Math.floor(maxResults)],
    );
    return { users: res.rows.map(toUserRecord) };
  }

  /**
   * Delegates to the Better Auth verifier: JWKS signature check plus the
   * session-liveness check, so a deleted user's outstanding tokens fail
   * here exactly like they fail at the host.
   */
  async verifyIdToken(token: string): Promise<DecodedIdToken> {
    const auth = await selfhostAuth();
    const authData = await auth.verifier(token);
    if (!authData) {
      throw new AuthShimError("auth/argument-error", "selfhost auth: invalid or revoked token");
    }
    return { ...authData.token, uid: authData.uid };
  }

  /**
   * Firebase semantics: REPLACES the whole claims object (null clears), and
   * reserved JWT claim names are rejected. Claims land in the token at the
   * next sign-in (definePayload reads auth_users.customClaims), same as
   * Firebase's next-token-refresh behavior.
   */
  async setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void> {
    for (const key of Object.keys(claims ?? {})) {
      if (RESERVED_CLAIMS.has(key)) {
        throw new AuthShimError("auth/forbidden-claim", `selfhost auth: reserved claim "${key}"`);
      }
    }
    const res = await runSql(
      `UPDATE auth_users SET "customClaims" = $3, "updatedAt" = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [getTenantId(), uid, JSON.stringify(claims ?? {})],
    );
    if (res.rows.length === 0) {
      throw new AuthShimError("auth/user-not-found", `selfhost auth: no user with uid ${uid}`);
    }
  }

  /**
   * Removes the account and everything hanging off it, sessions first —
   * killing the sessions is what revokes outstanding JWTs (the verifier's
   * sid check), the backstop behind the chunk-1 token decision.
   */
  async deleteUser(uid: string): Promise<void> {
    const client = await getSqlClient();
    await client.tx(getTenantId(), async (q) => {
      const t = getTenantId();
      await q(`DELETE FROM auth_sessions WHERE tenant_id = $1 AND "userId" = $2`, [t, uid]);
      await q(`DELETE FROM auth_accounts WHERE tenant_id = $1 AND "userId" = $2`, [t, uid]);
      await q(`DELETE FROM auth_members WHERE tenant_id = $1 AND "userId" = $2`, [t, uid]);
      const res = await q(`DELETE FROM auth_users WHERE tenant_id = $1 AND id = $2 RETURNING id`, [
        t,
        uid,
      ]);
      if (res.rows.length === 0) {
        throw new AuthShimError("auth/user-not-found", `selfhost auth: no user with uid ${uid}`);
      }
    });
  }
}

const singleton = new AuthShim();

export function getAuth(): AuthShim {
  return singleton;
}
