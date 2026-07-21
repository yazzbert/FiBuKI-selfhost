/**
 * Drizzle schema — the authoritative shape of the selfhost Postgres database.
 * Migrations are generated from this file (readable SQL under
 * functions/drizzle/) with:
 *
 *   npx drizzle-kit generate --name <slug>
 *
 * then applied at boot by db/migrate.ts through the shim's SqlClient, so the
 * exact same DDL runs against embedded PGlite (tests) and real Postgres
 * (compose / production).
 *
 * Multi-tenancy (docs/rewrite-goals.md §Multi-tenancy): shared schema,
 * tenant_id on EVERY table, the API layer enforces, RLS as backstop.
 * Self-host is multi-tenant with exactly one tenant — no special case.
 *
 * NOTE on RLS: drizzle-kit does not emit ENABLE/FORCE ROW LEVEL SECURITY or
 * CREATE POLICY, so every new table's migration gets a hand-appended RLS
 * block — copy the pattern at the bottom of drizzle/0000_init.sql. FORCE is
 * required: tests and the selfhost deployment connect as the table owner,
 * and without FORCE the owner bypasses policies entirely.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { FLATTENED, FlatKind, generatedColumnExpr } from "./collections";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The JSONB bridge table: every collection that has NOT yet been flattened
 * lives here, exactly as the Phase-0 shim stored it (plus tenant_id). It
 * shrinks collection by collection and is deleted when the last one leaves.
 */
export const docs = pgTable(
  "docs",
  {
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    path: text("path").notNull(),
    collection_path: text("collection_path").notNull(),
    id: text("id").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenant_id, t.path] }),
    index("docs_tenant_collection_idx").on(t.tenant_id, t.collection_path),
  ],
);

function generatedColumn(kind: FlatKind, col: string, fieldPath: string) {
  const expr = sql.raw(generatedColumnExpr(fieldPath, kind));
  switch (kind) {
    case "text":
      return text(col).generatedAlwaysAs(expr);
    case "boolean":
      return boolean(col).generatedAlwaysAs(expr);
    case "number":
      return doublePrecision(col).generatedAlwaysAs(expr);
    case "timestamp":
      return timestamp(col, { withTimezone: true }).generatedAlwaysAs(expr);
  }
}

/**
 * Build a flattened-collection table from its spec in collections.ts:
 * (tenant_id, id) PK, canonical `data` JSONB payload, and one STORED
 * GENERATED column per queried field. Keys are the SQL column names so the
 * spec's index tuples resolve directly.
 */
function flatTable(collection: string) {
  const spec = FLATTENED[collection];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cols: Record<string, any> = {
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    data: jsonb("data").notNull(),
  };
  for (const [fieldPath, f] of Object.entries(spec.fields)) {
    cols[f.col] = generatedColumn(f.kind, f.col, fieldPath);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pgTable(spec.table, cols, (t: Record<string, any>) => [
    primaryKey({ columns: [t.tenant_id, t.id] }),
    ...spec.indexes.map((tuple) => {
      const [first, ...rest] = tuple.map((c) => t[c]);
      return index(`${spec.table}_${tuple.join("_")}_idx`).on(first, ...rest);
    }),
  ]);
}

export const sources = flatTable("sources");
export const transactions = flatTable("transactions");
export const files = flatTable("files");
export const partners = flatTable("partners");
export const fileConnections = flatTable("fileConnections");
