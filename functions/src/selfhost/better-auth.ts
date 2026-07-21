/**
 * Better Auth wiring for the selfhost build (W1) — the seam defined by
 * better-auth.test.ts, kept deliberately small:
 *
 *   handler   — Better Auth's fetch handler, mounted by the host at /__auth
 *               (chunk 3)
 *   verifier  — TokenVerifier for createHost(): local JWKS verification of
 *               the JWT plugin's tokens PLUS a session-liveness check, so
 *               revoking a session (deleteUser) revokes its tokens too
 *   provisionUser — the ONLY way accounts come to exist (invite-only
 *               product; also the W2/W3 migration entry point). Caller may
 *               provide the uid — Firebase uids are preserved verbatim.
 *   signInEmail — credential sign-in returning a JWKS-verifiable JWT
 *
 * Storage: the auth_* tables authored in db/schema.ts (migration
 * drizzle/0005_better_auth.sql), reached through a custom Better Auth
 * adapter that routes EVERY operation through the firestore-shim's shared
 * SqlClient — same serialized PGlite instance in tests, same node-postgres
 * pool in production, one tenant-scoped app-role transaction per operation
 * (RLS armed, like all document IO). No second connection, no auth
 * container.
 *
 * Token shape (decision 2026-07-21, docs/decisions.md): Better Auth JWT
 * plugin — tokens are locally-decodable JWTs verified against the
 * database-backed JWKS, the same machinery oidc-verifier.ts uses for
 * external issuers. The payload carries `sid` (session id) so the verifier
 * can refuse tokens whose session is gone.
 */

import { betterAuth } from "better-auth";
import { createAdapterFactory } from "better-auth/adapters";
import type { CleanedWhere } from "better-auth/adapters";
import { bearer } from "better-auth/plugins/bearer";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { createLocalJWKSet, jwtVerify } from "jose";
import { getFirestore, getSqlClient } from "./firestore-shim";
import { getTenantId } from "./db/tenant";
import type { TokenVerifier } from "./host";

export interface SelfhostAuth {
  handler: (req: Request) => Promise<Response>;
  verifier: TokenVerifier;
  provisionUser(opts: {
    uid?: string;
    email: string;
    password?: string;
    displayName?: string;
    admin?: boolean;
  }): Promise<{ uid: string }>;
  signInEmail(email: string, password: string): Promise<{ token: string }>;
}

// ---------------------------------------------------------------------------
// Adapter: Better Auth models -> auth_* tables through the shared SqlClient
// ---------------------------------------------------------------------------

/**
 * timestamptz columns per table, for coercing driver output to Date — the
 * node-postgres pool returns Dates already; PGlite may return ISO strings
 * depending on version, and Better Auth compares these against `new Date()`.
 */
const DATE_COLUMNS: Record<string, ReadonlySet<string>> = {
  auth_users: new Set(["createdAt", "updatedAt"]),
  auth_sessions: new Set(["expiresAt", "createdAt", "updatedAt"]),
  auth_accounts: new Set([
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt",
    "createdAt",
    "updatedAt",
  ]),
  auth_verifications: new Set(["expiresAt", "createdAt", "updatedAt"]),
  auth_organizations: new Set(["createdAt"]),
  auth_members: new Set(["createdAt"]),
  auth_invitations: new Set(["expiresAt", "createdAt"]),
  auth_jwks: new Set(["createdAt", "expiresAt"]),
};

const KNOWN_TABLES = new Set(Object.keys(DATE_COLUMNS));

/**
 * Quote a SQL identifier. Table/field names only ever come from Better
 * Auth's schema (camelCase column names match its default field names
 * 1:1 — see db/schema.ts), but validate anyway: these strings are
 * interpolated into SQL.
 */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`selfhost better-auth adapter: invalid SQL identifier "${name}"`);
  }
  return `"${name}"`;
}

function table(model: string): string {
  if (!KNOWN_TABLES.has(model)) {
    throw new Error(`selfhost better-auth adapter: unknown model/table "${model}"`);
  }
  return ident(model);
}

/** Drop tenant_id and coerce timestamptz strings to Date on a returned row. */
function outputRow(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const dates = DATE_COLUMNS[model];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "tenant_id") continue;
    out[k] = dates?.has(k) && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

interface CompiledWhere {
  sql: string; // starts with "WHERE tenant_id = $1 ..."
  params: unknown[];
}

/**
 * Compile a CleanedWhere list. Semantics mirror Better Auth's own kysely
 * adapter: AND-connected terms are all required, OR-connected terms form one
 * disjunctive group, and both groups must hold. tenant_id scoping is always
 * prepended (RLS enforces it anyway; the explicit predicate keeps the
 * planner on the composite indexes).
 */
function compileWhere(where: CleanedWhere[] | undefined): CompiledWhere {
  const params: unknown[] = [getTenantId()];
  const clauses: { sql: string; connector: "AND" | "OR" }[] = [];

  for (const w of where ?? []) {
    const col = ident(w.field);
    const op = w.operator.toLowerCase();
    const insensitive =
      w.mode === "insensitive" &&
      (typeof w.value === "string" ||
        (Array.isArray(w.value) && w.value.every((v) => typeof v === "string")));
    const lhs = insensitive && op !== "contains" && op !== "starts_with" && op !== "ends_with"
      ? `lower(${col})`
      : col;
    const bind = (v: unknown): string => {
      params.push(insensitive && typeof v === "string" ? v.toLowerCase() : v);
      return `$${params.length}`;
    };
    const like = insensitive ? "ILIKE" : "LIKE";

    let sql: string;
    switch (op) {
      case "eq":
        sql = w.value === null ? `${col} IS NULL` : `${lhs} = ${bind(w.value)}`;
        break;
      case "ne":
        sql = w.value === null ? `${col} IS NOT NULL` : `${lhs} <> ${bind(w.value)}`;
        break;
      case "lt":
        sql = `${col} < ${bind(w.value)}`;
        break;
      case "lte":
        sql = `${col} <= ${bind(w.value)}`;
        break;
      case "gt":
        sql = `${col} > ${bind(w.value)}`;
        break;
      case "gte":
        sql = `${col} >= ${bind(w.value)}`;
        break;
      case "in":
      case "not_in": {
        const values = Array.isArray(w.value) ? w.value : [w.value];
        if (values.length === 0) {
          sql = op === "in" ? "FALSE" : "TRUE";
        } else {
          const list = values.map((v) => bind(v)).join(", ");
          sql = `${lhs} ${op === "in" ? "IN" : "NOT IN"} (${list})`;
        }
        break;
      }
      case "contains":
        sql = `${col} ${like} ${bind(`%${w.value}%`)}`;
        break;
      case "starts_with":
        sql = `${col} ${like} ${bind(`${w.value}%`)}`;
        break;
      case "ends_with":
        sql = `${col} ${like} ${bind(`%${w.value}`)}`;
        break;
      default:
        throw new Error(`selfhost better-auth adapter: unsupported operator "${w.operator}"`);
    }
    clauses.push({ sql, connector: w.connector });
  }

  const ands = clauses.filter((c) => c.connector !== "OR").map((c) => c.sql);
  const ors = clauses.filter((c) => c.connector === "OR").map((c) => c.sql);
  let sql = "WHERE tenant_id = $1";
  if (ands.length) sql += ` AND ${ands.join(" AND ")}`;
  if (ors.length) sql += ` AND (${ors.join(" OR ")})`;
  return { sql, params };
}

type Row = Record<string, unknown>;

async function runSql(sql: string, params: unknown[]): Promise<{ rows: Row[] }> {
  const client = await getSqlClient();
  return client.tx(getTenantId(), (q) => q(sql, params));
}

const selfhostAdapter = createAdapterFactory({
  config: {
    adapterId: "fibuki-selfhost",
    adapterName: "FiBuKI selfhost SQL adapter",
    // JSON fields (organization.metadata, user.customClaims) are stored as
    // text — Better Auth stringifies/parses them for us.
    supportsJSON: false,
    supportsDates: true,
    supportsBooleans: true,
    supportsNumericIds: false,
    // Each operation is one tenant-scoped transaction through the shared
    // SqlClient; cross-operation transactions would deadlock the serialized
    // single-connection PGlite queue, so ops compose sequentially instead.
    transaction: false,
  },
  adapter: () => ({
    async create({ model, data }) {
      const t = table(model);
      const cols = Object.keys(data);
      const params: unknown[] = [getTenantId()];
      const placeholders = cols.map((c) => {
        params.push((data as Row)[c]);
        return `$${params.length}`;
      });
      const res = await runSql(
        `INSERT INTO ${t} (tenant_id${cols.length ? ", " : ""}${cols.map(ident).join(", ")})
         VALUES ($1${placeholders.length ? ", " : ""}${placeholders.join(", ")})
         RETURNING *`,
        params,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return outputRow(model, res.rows[0]) as any;
    },

    async findOne({ model, where, select }) {
      const t = table(model);
      const w = compileWhere(where);
      const projection = select?.length ? select.map(ident).join(", ") : "*";
      const res = await runSql(`SELECT ${projection} FROM ${t} ${w.sql} LIMIT 1`, w.params);
      if (res.rows.length === 0) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return outputRow(model, res.rows[0]) as any;
    },

    async findMany({ model, where, limit, sortBy, offset, select }) {
      const t = table(model);
      const w = compileWhere(where);
      const projection = select?.length ? select.map(ident).join(", ") : "*";
      let sql = `SELECT ${projection} FROM ${t} ${w.sql}`;
      if (sortBy) sql += ` ORDER BY ${ident(sortBy.field)} ${sortBy.direction === "desc" ? "DESC" : "ASC"}`;
      if (typeof limit === "number" && Number.isFinite(limit)) sql += ` LIMIT ${Math.floor(limit)}`;
      if (offset) sql += ` OFFSET ${Math.floor(offset)}`;
      const res = await runSql(sql, w.params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return res.rows.map((r) => outputRow(model, r)) as any;
    },

    async update({ model, where, update }) {
      const t = table(model);
      const w = compileWhere(where);
      const sets = Object.entries(update as Row).map(([k, v]) => {
        w.params.push(v);
        return `${ident(k)} = $${w.params.length}`;
      });
      if (sets.length === 0) return null;
      const res = await runSql(`UPDATE ${t} SET ${sets.join(", ")} ${w.sql} RETURNING *`, w.params);
      if (res.rows.length === 0) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return outputRow(model, res.rows[0]) as any;
    },

    async updateMany({ model, where, update }) {
      const t = table(model);
      const w = compileWhere(where);
      const sets = Object.entries(update).map(([k, v]) => {
        w.params.push(v);
        return `${ident(k)} = $${w.params.length}`;
      });
      if (sets.length === 0) return 0;
      const res = await runSql(
        `UPDATE ${t} SET ${sets.join(", ")} ${w.sql} RETURNING id`,
        w.params,
      );
      return res.rows.length;
    },

    async delete({ model, where }) {
      const t = table(model);
      const w = compileWhere(where);
      await runSql(`DELETE FROM ${t} ${w.sql}`, w.params);
    },

    async deleteMany({ model, where }) {
      const t = table(model);
      const w = compileWhere(where);
      const res = await runSql(`DELETE FROM ${t} ${w.sql} RETURNING id`, w.params);
      return res.rows.length;
    },

    async count({ model, where }) {
      const t = table(model);
      const w = compileWhere(where);
      const res = await runSql(`SELECT count(*)::int AS n FROM ${t} ${w.sql}`, w.params);
      return Number(res.rows[0]?.n ?? 0);
    },
  }),
});

// ---------------------------------------------------------------------------
// Better Auth instance
// ---------------------------------------------------------------------------

/**
 * Issuer/audience for the JWT plugin and base URL for Better Auth routes.
 * Chunk 3 mounts the handler on the host at /__auth; until a deployment
 * sets FIBUKI_AUTH_ISSUER (or BETTER_AUTH_URL) the tokens are minted and
 * verified in-process against this stable placeholder, which never needs
 * to be reachable.
 */
function issuerUrl(): string {
  return (
    process.env.FIBUKI_AUTH_ISSUER ||
    process.env.BETTER_AUTH_URL ||
    "http://fibuki-selfhost.internal"
  );
}

function superAdminEmail(): string | undefined {
  return process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || undefined;
}

function parseClaims(user: Record<string, unknown>): Record<string, unknown> {
  const raw = user.customClaims;
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function buildAuth() {
  const issuer = issuerUrl();
  return betterAuth({
    baseURL: issuer,
    basePath: "/__auth",
    secret: process.env.FIBUKI_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || undefined,
    database: selfhostAdapter,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // Invite-only product: accounts exist only via provisionUser.
      disableSignUp: true,
    },
    user: {
      modelName: "auth_users",
      additionalFields: {
        // firebase-admin custom-claims port (chunk 2 wires
        // setCustomUserClaims onto this) — a JSON string, like Firebase
        // stores arbitrary claim objects.
        customClaims: { type: "string", required: false, input: false },
      },
    },
    session: { modelName: "auth_sessions" },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    plugins: [
      organization({
        schema: {
          organization: { modelName: "auth_organizations" },
          member: { modelName: "auth_members" },
          invitation: { modelName: "auth_invitations" },
        },
      }),
      // Lets server-side calls (and later the client shim) present the raw
      // session token as `Authorization: Bearer` — used by signInEmail to
      // mint the JWT right after sign-in.
      bearer(),
      jwt({
        schema: { jwks: { modelName: "auth_jwks" } },
        jwt: {
          issuer,
          audience: issuer,
          definePayload: ({ user, session }) => {
            const claims = parseClaims(user);
            const admin =
              claims.admin === true || user.email.toLowerCase() === superAdminEmail();
            return {
              ...claims,
              email: user.email,
              email_verified: user.emailVerified,
              name: user.name,
              admin,
              // Session id: the verifier refuses tokens whose session is
              // gone (deleteUser kills sessions -> kills tokens).
              sid: session.id,
            };
          },
        },
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

export async function createSelfhostAuth(): Promise<SelfhostAuth> {
  // Fail fast if the database (and its migrations) can't come up.
  await getSqlClient();
  const auth = buildAuth();
  const issuer = issuerUrl();

  // Local JWKS verification with one refetch on key-miss (first token after
  // boot, or key rotation) — same machinery as oidc-verifier.ts, but the
  // key set comes from the auth_jwks table instead of a remote issuer.
  let keySet: ReturnType<typeof createLocalJWKSet> | null = null;
  const fetchKeySet = async () => createLocalJWKSet(await auth.api.getJwks());
  const verifyJwt = async (token: string) => {
    if (!keySet) keySet = await fetchKeySet();
    try {
      return await jwtVerify(token, keySet, { issuer, audience: issuer });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ERR_JWKS_NO_MATCHING_KEY" || code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
        keySet = await fetchKeySet();
        return await jwtVerify(token, keySet, { issuer, audience: issuer });
      }
      throw err;
    }
  };

  const sessionAlive = async (sessionId: string): Promise<boolean> => {
    const res = await runSql(
      `SELECT 1 FROM auth_sessions WHERE tenant_id = $1 AND id = $2 AND "expiresAt" > now()`,
      [getTenantId(), sessionId],
    );
    return res.rows.length > 0;
  };

  const verifier: TokenVerifier = async (token) => {
    if (!token) return null;
    try {
      const { payload } = await verifyJwt(token);
      const uid = typeof payload.sub === "string" && payload.sub ? payload.sub : undefined;
      const sid = typeof payload.sid === "string" && payload.sid ? payload.sid : undefined;
      if (!uid || !sid) return null;
      if (!(await sessionAlive(sid))) return null;
      return { uid, token: { ...payload, admin: payload.admin === true } };
    } catch {
      // Any verification failure -> unauthenticated (host answers 401).
      return null;
    }
  };

  const assertInvited = async (email: string): Promise<void> => {
    // Same invite gate, same data as the Firebase build (CLAUDE.md auth
    // section): allowedEmails collection, SUPER_ADMIN_EMAIL exempt.
    if (email === superAdminEmail()) return;
    const snap = await getFirestore()
      .collection("allowedEmails")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (snap.empty) {
      throw new Error(
        `selfhost auth: ${email} is not in allowedEmails — this product is invite-only`,
      );
    }
  };

  const provisionUser: SelfhostAuth["provisionUser"] = async (opts) => {
    const email = opts.email.trim().toLowerCase();
    await assertInvited(email);
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      ...(opts.uid ? { id: opts.uid } : {}),
      email,
      name: opts.displayName ?? email,
      // Provisioned, never self-registered: the invite IS the verification.
      emailVerified: true,
      ...(opts.admin ? { customClaims: JSON.stringify({ admin: true }) } : {}),
    });
    // No password -> no credential account (migrated users get a forced
    // reset in W2); with one, link a credential account like Better Auth's
    // own sign-up path does.
    if (opts.password !== undefined) {
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await ctx.password.hash(opts.password),
      });
    }
    return { uid: user.id };
  };

  const signInEmail: SelfhostAuth["signInEmail"] = async (email, password) => {
    const res = await auth.api.signInEmail({
      body: { email: email.trim().toLowerCase(), password },
    });
    if (!res.token) {
      throw new Error("selfhost auth: sign-in produced no session token");
    }
    // Exchange the session for a JWKS-verifiable JWT (the bearer plugin
    // accepts the raw session token).
    const { token } = await auth.api.getToken({
      headers: new Headers({ authorization: `Bearer ${res.token}` }),
    });
    return { token };
  };

  return {
    handler: (req) => auth.handler(req),
    verifier,
    provisionUser,
    signInEmail,
  };
}
