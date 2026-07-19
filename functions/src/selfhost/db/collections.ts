/**
 * Single source of truth for FLATTENED collections — Phase 1 of the
 * Firebase → Postgres rebuild (docs/rewrite-goals.md §Phase 1).
 *
 * A flattened collection moves out of the JSONB `docs` bridge table into its
 * own real table. The canonical document payload stays in a `data` JSONB
 * column (it is what round-trips through the Firestore shim, preserving
 * Firestore's absent-vs-null distinction that the parity suite pins); the
 * fields the app filters or orders on become STORED GENERATED columns over
 * that payload — real, indexable, joinable columns that can never skew from
 * the document because Postgres derives them on write.
 *
 * Both the Drizzle schema (schema.ts) and the shim's SQL pushdown
 * (pushdown.ts) are driven from this map, so a field added here shows up in
 * the next generated migration AND becomes pushdown-eligible with no second
 * edit.
 *
 * Phase 2 (rip the shim) turns the generated columns into plain columns and
 * drops `data`; at that point absent-vs-null stops mattering because the app
 * talks SQL, not Firestore.
 */

export type FlatKind = "text" | "boolean" | "number" | "timestamp";

export interface FlatField {
  /** SQL column name of the generated column. */
  col: string;
  kind: FlatKind;
}

export interface FlatSpec {
  /** SQL table name. */
  table: string;
  /**
   * Firestore field path (dot notation for nested maps) → generated column.
   * Only fields that appear in where()/orderBy() calls need to be here.
   */
  fields: Record<string, FlatField>;
  /** Column tuples to index beyond the (tenant_id, id) PK. */
  indexes: string[][];
}

/**
 * Timestamp wire format inside the JSONB payload (see firestore-shim.ts
 * TS_MARKER): { "__fbts__": { "s": seconds, "n": nanoseconds } }.
 */
const TS_MARKER = "__fbts__";

/** `data->'a'->'b'` selector for a dot-path. */
export function jsonNode(fieldPath: string): string {
  const segs = fieldPath.split(".");
  return `"data"` + segs.map((s) => `->'${s}'`).join("");
}

/**
 * SQL expression for a STORED GENERATED column projecting `fieldPath` out of
 * the `data` JSONB payload. Type-guarded with jsonb_typeof so a document
 * carrying an unexpected type yields NULL instead of failing the write.
 * Every function used (jsonb_typeof, ->, ->>, #>>, ?, to_timestamp(float8),
 * casts) is IMMUTABLE, which STORED generated columns require.
 */
export function generatedColumnExpr(fieldPath: string, kind: FlatKind): string {
  const node = jsonNode(fieldPath);
  const asText = `${node} #>> '{}'`;
  switch (kind) {
    case "text":
      return `CASE WHEN jsonb_typeof(${node}) = 'string' THEN ${asText} END`;
    case "boolean":
      return `CASE WHEN jsonb_typeof(${node}) = 'boolean' THEN (${asText})::boolean END`;
    case "number":
      return `CASE WHEN jsonb_typeof(${node}) = 'number' THEN (${asText})::double precision END`;
    case "timestamp":
      // Shim Timestamps are { __fbts__: { s, n } }. double precision keeps
      // ~0.2µs resolution at current epoch seconds — finer than the
      // microsecond precision of both timestamptz and real Firestore.
      return (
        `CASE WHEN ${node} ? '${TS_MARKER}' THEN ` +
        `to_timestamp((${node}->'${TS_MARKER}'->>'s')::double precision + ` +
        `(${node}->'${TS_MARKER}'->>'n')::double precision / 1e9) END`
      );
  }
}

/**
 * The flattened collections. Order of migration follows app call-site
 * weight (transactions 175 > files 125 > partners 92 > sources 53), but
 * `sources` goes first as the harness-proving collection: real query
 * traffic, simple shapes, no subcollections.
 *
 * Adding a collection here requires: (1) a table in schema.ts (mirrored from
 * this spec), (2) `npx drizzle-kit generate`, (3) appending the RLS
 * ENABLE/FORCE/POLICY block for the new table to the generated migration —
 * see drizzle/0000_*.sql for the pattern. The migration runner's backfill
 * step moves existing rows out of `docs` automatically.
 */
export const FLATTENED: Readonly<Record<string, FlatSpec>> = {
  sources: {
    table: "sources",
    fields: {
      // Query call sites: tools/handlers.ts, sources/*, banking/*,
      // matching/*, extraction/extractionCore.ts, user-export/*.
      userId: { col: "user_id", kind: "text" },
      isActive: { col: "is_active", kind: "boolean" },
      name: { col: "name", kind: "text" },
      linkedSourceId: { col: "linked_source_id", kind: "text" },
      "apiConfig.accountId": { col: "api_config_account_id", kind: "text" },
      // No current where()/orderBy() call site, but this exercises the
      // timestamp generated-column + pushdown path ahead of the collections
      // that need it (transactions/files order by dates constantly).
      createdAt: { col: "created_at", kind: "timestamp" },
    },
    indexes: [["tenant_id", "user_id"]],
  },
};
