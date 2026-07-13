/**
 * Postgres-backed drop-in for the `firebase-admin/firestore` module surface
 * FiBuKI actually uses. Swapped in at module resolution (vitest/bundler
 * alias) — application code is unchanged.
 *
 * Spike scope: documents live in one JSONB table; query filters/order/limit
 * are applied in JS after an equality-pushdown fetch. Production hardening
 * (SQL pushdown, indexes, real connection pool) comes after Gate 3 passes.
 *
 * FieldValue / Timestamp are the REAL classes from @google-cloud/firestore
 * (pure sentinels / data classes) — exact semantics, zero reimplementation.
 * The shim interprets the sentinels at write time, mirroring how the
 * Firestore backend applies transforms.
 */

import { PGlite } from "@electric-sql/pglite";
import { FieldValue, Timestamp } from "@google-cloud/firestore";
import { emitChange } from "./bus";

export { FieldValue, Timestamp };

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let pgPromise: Promise<PGlite> | null = null;

async function getPg(): Promise<PGlite> {
  if (!pgPromise) {
    pgPromise = (async () => {
      const pg = new PGlite(); // in-memory; production passes a data dir / real PG
      await pg.query(`
        CREATE TABLE IF NOT EXISTS docs (
          path TEXT PRIMARY KEY,
          collection_path TEXT NOT NULL,
          id TEXT NOT NULL,
          data JSONB NOT NULL
        );
      `);
      await pg.query(`CREATE INDEX IF NOT EXISTS docs_collection_idx ON docs (collection_path);`);
      return pg;
    })();
  }
  return pgPromise;
}

/** Test helper: wipe all documents. */
export async function __resetFirestoreShim(): Promise<void> {
  const pg = await getPg();
  await pg.query(`DELETE FROM docs;`);
}

// ---------------------------------------------------------------------------
// Encoding: JS values <-> JSONB
// ---------------------------------------------------------------------------

const TS_MARKER = "__fbts__";

function isTimestampLike(v: unknown): v is Timestamp {
  return v instanceof Timestamp;
}

function encodeValue(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (isTimestampLike(v)) return { [TS_MARKER]: { s: v.seconds, n: v.nanoseconds } };
  if (v instanceof Date) {
    const ts = Timestamp.fromDate(v);
    return { [TS_MARKER]: { s: ts.seconds, n: ts.nanoseconds } };
  }
  if (Array.isArray(v)) return v.map((x) => encodeValue(x));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const enc = encodeValue(val);
      if (enc !== undefined) out[k] = enc;
    }
    return out;
  }
  return v;
}

function decodeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x));
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const marker = obj[TS_MARKER] as { s: number; n: number } | undefined;
    if (marker && Object.keys(obj).length === 1) {
      return new Timestamp(marker.s, marker.n);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) out[k] = decodeValue(val);
    return out;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Sentinel (FieldValue transform) application
// ---------------------------------------------------------------------------

function sentinelKind(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const name = (v as object).constructor?.name || "";
  if (name.includes("ServerTimestamp")) return "serverTimestamp";
  if (name.includes("ArrayUnion")) return "arrayUnion";
  if (name.includes("ArrayRemove")) return "arrayRemove";
  if (name.includes("NumericIncrement")) return "increment";
  if (name === "DeleteTransform" || name.includes("Delete")) return "delete";
  return null;
}

function sentinelElements(v: unknown): unknown[] {
  return ((v as { elements?: unknown[] }).elements || []) as unknown[];
}

function sentinelOperand(v: unknown): number {
  return Number((v as { operand?: number }).operand ?? 0);
}

function deepGet(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, obj);
}

function deepSet(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const segs = dotPath.split(".");
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (!cur[seg] || typeof cur[seg] !== "object" || Array.isArray(cur[seg])) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

function deepDelete(obj: Record<string, unknown>, dotPath: string): void {
  const segs = dotPath.split(".");
  let cur: Record<string, unknown> | undefined = obj;
  for (let i = 0; i < segs.length - 1 && cur; i++) {
    cur = cur[segs[i]] as Record<string, unknown> | undefined;
  }
  if (cur && typeof cur === "object") delete cur[segs[segs.length - 1]];
}

/**
 * Apply an update payload (supports dot-path keys + FieldValue sentinels)
 * onto an existing decoded document. Returns the new decoded document.
 */
function applyUpdate(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(encodeValue(existing)));
  const decoded = decodeValue(result) as Record<string, unknown>; // deep clone preserving Timestamps
  for (const [key, value] of Object.entries(updates)) {
    const kind = sentinelKind(value);
    if (kind === "serverTimestamp") {
      deepSet(decoded, key, Timestamp.now());
    } else if (kind === "delete") {
      deepDelete(decoded, key);
    } else if (kind === "arrayUnion") {
      const cur = deepGet(decoded, key);
      const arr = Array.isArray(cur) ? [...cur] : [];
      for (const el of sentinelElements(value)) {
        if (!arr.some((x) => JSON.stringify(encodeValue(x)) === JSON.stringify(encodeValue(el)))) {
          arr.push(el);
        }
      }
      deepSet(decoded, key, arr);
    } else if (kind === "arrayRemove") {
      const cur = deepGet(decoded, key);
      const removals = sentinelElements(value).map((el) => JSON.stringify(encodeValue(el)));
      const arr = (Array.isArray(cur) ? cur : []).filter(
        (x) => !removals.includes(JSON.stringify(encodeValue(x))),
      );
      deepSet(decoded, key, arr);
    } else if (kind === "increment") {
      const cur = deepGet(decoded, key);
      deepSet(decoded, key, (typeof cur === "number" ? cur : 0) + sentinelOperand(value));
    } else if (value === undefined) {
      // Firestore rejects undefined; tolerate by skipping
    } else {
      deepSet(decoded, key, applySentinelsInPlace(value));
    }
  }
  return decoded;
}

/** Sentinels nested inside object values of a set() payload. */
function applySentinelsInPlace(value: unknown): unknown {
  const kind = sentinelKind(value);
  if (kind === "serverTimestamp") return Timestamp.now();
  if (kind === "delete") return undefined;
  if (kind === "arrayUnion") return sentinelElements(value);
  if (kind === "arrayRemove") return [];
  if (kind === "increment") return sentinelOperand(value);
  if (Array.isArray(value)) return value.map((v) => applySentinelsInPlace(v));
  if (value && typeof value === "object" && !isTimestampLike(value) && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const applied = applySentinelsInPlace(v);
      if (applied !== undefined) out[k] = applied;
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Low-level doc IO (all writes emit bus changes)
// ---------------------------------------------------------------------------

async function rawGet(path: string): Promise<Record<string, unknown> | undefined> {
  const pg = await getPg();
  const res = await pg.query<{ data: unknown }>(`SELECT data FROM docs WHERE path = $1`, [path]);
  if (res.rows.length === 0) return undefined;
  return decodeValue(res.rows[0].data) as Record<string, unknown>;
}

async function rawPut(
  collectionPath: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const pg = await getPg();
  const path = `${collectionPath}/${id}`;
  await pg.query(
    `INSERT INTO docs (path, collection_path, id, data) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data`,
    [path, collectionPath, id, JSON.stringify(encodeValue(data))],
  );
}

async function rawDelete(path: string): Promise<void> {
  const pg = await getPg();
  await pg.query(`DELETE FROM docs WHERE path = $1`, [path]);
}

async function writeDoc(
  collectionPath: string,
  id: string,
  next: Record<string, unknown> | undefined,
): Promise<void> {
  const path = `${collectionPath}/${id}`;
  const before = await rawGet(path);
  if (next === undefined) {
    await rawDelete(path);
  } else {
    await rawPut(collectionPath, id, next);
  }
  emitChange({ collectionPath, id, path, before, after: next });
}

// ---------------------------------------------------------------------------
// Snapshots / references / queries
// ---------------------------------------------------------------------------

export class DocSnapshot {
  constructor(
    public readonly id: string,
    private readonly _data: Record<string, unknown> | undefined,
    public readonly ref: DocRef,
  ) {}
  get exists(): boolean {
    return this._data !== undefined;
  }
  data(): Record<string, unknown> | undefined {
    return this._data;
  }
  get(field: string): unknown {
    return this._data ? deepGet(this._data, field) : undefined;
  }
  get createTime(): Timestamp {
    return Timestamp.now();
  }
  get updateTime(): Timestamp {
    return Timestamp.now();
  }
}

interface Filter {
  field: string;
  op: string;
  value: unknown;
}

function toComparable(v: unknown): number | string {
  if (isTimestampLike(v)) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" || typeof v === "string") return v;
  if (v === null || v === undefined) return Number.NEGATIVE_INFINITY;
  return String(v);
}

function cmp(a: unknown, b: unknown): number {
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (typeof ca === "string" || typeof cb === "string") {
    return String(ca) < String(cb) ? -1 : String(ca) > String(cb) ? 1 : 0;
  }
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (isTimestampLike(a) || isTimestampLike(b) || a instanceof Date || b instanceof Date) {
    return toComparable(a) === toComparable(b);
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(encodeValue(a)) === JSON.stringify(encodeValue(b));
  }
  return a === b;
}

function matchesFilter(data: Record<string, unknown>, f: Filter): boolean {
  const v = deepGet(data, f.field);
  switch (f.op) {
    case "==":
      return valueEquals(v, f.value);
    case "!=":
      return v !== undefined && !valueEquals(v, f.value);
    case ">":
      return v !== undefined && cmp(v, f.value) > 0;
    case ">=":
      return v !== undefined && cmp(v, f.value) >= 0;
    case "<":
      return v !== undefined && cmp(v, f.value) < 0;
    case "<=":
      return v !== undefined && cmp(v, f.value) <= 0;
    case "array-contains":
      return Array.isArray(v) && v.some((x) => valueEquals(x, f.value));
    case "array-contains-any":
      return (
        Array.isArray(v) &&
        Array.isArray(f.value) &&
        (f.value as unknown[]).some((fv) => (v as unknown[]).some((x) => valueEquals(x, fv)))
      );
    case "in":
      return Array.isArray(f.value) && (f.value as unknown[]).some((fv) => valueEquals(v, fv));
    case "not-in":
      return (
        v !== undefined &&
        Array.isArray(f.value) &&
        !(f.value as unknown[]).some((fv) => valueEquals(v, fv))
      );
    default:
      throw new Error(`selfhost firestore shim: unsupported operator '${f.op}'`);
  }
}

export class Query {
  constructor(
    protected readonly collectionPath: string,
    protected readonly filters: Filter[] = [],
    protected readonly orders: Array<{ field: string; dir: "asc" | "desc" }> = [],
    protected readonly limitN: number | null = null,
    protected readonly offsetN: number = 0,
  ) {}

  where(field: string, op: string, value: unknown): Query {
    return new Query(
      this.collectionPath,
      [...this.filters, { field, op, value }],
      this.orders,
      this.limitN,
      this.offsetN,
    );
  }

  orderBy(field: string, dir: "asc" | "desc" = "asc"): Query {
    return new Query(
      this.collectionPath,
      this.filters,
      [...this.orders, { field, dir }],
      this.limitN,
      this.offsetN,
    );
  }

  limit(n: number): Query {
    return new Query(this.collectionPath, this.filters, this.orders, n, this.offsetN);
  }

  offset(n: number): Query {
    return new Query(this.collectionPath, this.filters, this.orders, this.limitN, n);
  }

  select(..._fields: string[]): Query {
    return this; // projection ignored — full docs returned
  }

  async get(): Promise<QuerySnapshot> {
    const pg = await getPg();
    // Spike: fetch the collection, filter in JS. Production: push filters to SQL.
    const res = await pg.query<{ id: string; data: unknown }>(
      `SELECT id, data FROM docs WHERE collection_path = $1`,
      [this.collectionPath],
    );
    let rows = res.rows.map((r) => ({
      id: r.id,
      data: decodeValue(r.data) as Record<string, unknown>,
    }));
    for (const f of this.filters) rows = rows.filter((r) => matchesFilter(r.data, f));
    for (const o of [...this.orders].reverse()) {
      rows.sort(
        (a, b) =>
          (o.dir === "desc" ? -1 : 1) * cmp(deepGet(a.data, o.field), deepGet(b.data, o.field)),
      );
    }
    if (this.offsetN) rows = rows.slice(this.offsetN);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    const docs = rows.map(
      (r) => new DocSnapshot(r.id, r.data, new DocRef(this.collectionPath, r.id)),
    );
    return new QuerySnapshot(docs);
  }

  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const snap = await this.get();
        return { data: () => ({ count: snap.size }) };
      },
    };
  }
}

export class QuerySnapshot {
  constructor(public readonly docs: DocSnapshot[]) {}
  get empty(): boolean {
    return this.docs.length === 0;
  }
  get size(): number {
    return this.docs.length;
  }
  forEach(fn: (doc: DocSnapshot) => void): void {
    this.docs.forEach(fn);
  }
}

function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export class DocRef {
  constructor(
    public readonly collectionPath: string,
    public readonly id: string,
  ) {}

  get path(): string {
    return `${this.collectionPath}/${this.id}`;
  }

  get parent(): CollectionRef {
    return new CollectionRef(this.collectionPath);
  }

  collection(name: string): CollectionRef {
    return new CollectionRef(`${this.path}/${name}`);
  }

  async get(): Promise<DocSnapshot> {
    const data = await rawGet(this.path);
    return new DocSnapshot(this.id, data, this);
  }

  async set(
    data: Record<string, unknown>,
    opts?: { merge?: boolean },
  ): Promise<{ writeTime: Timestamp }> {
    const processed = applySentinelsInPlace(data) as Record<string, unknown>;
    let next = processed;
    if (opts?.merge) {
      const existing = (await rawGet(this.path)) || {};
      next = applyUpdate(existing, flattenForMerge(processed));
    }
    await writeDoc(this.collectionPath, this.id, next);
    return { writeTime: Timestamp.now() };
  }

  async update(data: Record<string, unknown>): Promise<{ writeTime: Timestamp }> {
    const existing = await rawGet(this.path);
    if (existing === undefined) {
      throw new Error(`selfhost firestore shim: update() on missing doc ${this.path}`);
    }
    const next = applyUpdate(existing, data);
    await writeDoc(this.collectionPath, this.id, next);
    return { writeTime: Timestamp.now() };
  }

  async create(data: Record<string, unknown>): Promise<{ writeTime: Timestamp }> {
    const existing = await rawGet(this.path);
    if (existing !== undefined) {
      throw new Error(`selfhost firestore shim: create() on existing doc ${this.path}`);
    }
    return this.set(data);
  }

  async delete(): Promise<{ writeTime: Timestamp }> {
    await writeDoc(this.collectionPath, this.id, undefined);
    return { writeTime: Timestamp.now() };
  }
}

/** set(merge:true) merges shallow-by-top-level-key like Firestore field paths. */
function flattenForMerge(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

export class CollectionRef extends Query {
  constructor(collectionPath: string) {
    super(collectionPath);
  }

  get id(): string {
    const segs = this.collectionPath.split("/");
    return segs[segs.length - 1];
  }

  get path(): string {
    return this.collectionPath;
  }

  doc(id?: string): DocRef {
    return new DocRef(this.collectionPath, id || generateId());
  }

  async add(data: Record<string, unknown>): Promise<DocRef> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }

  async listDocuments(): Promise<DocRef[]> {
    const snap = await this.get();
    return snap.docs.map((d) => d.ref);
  }
}

// ---------------------------------------------------------------------------
// Batch / transaction (spike: sequential application, single-writer model)
// ---------------------------------------------------------------------------

class WriteBatch {
  private ops: Array<() => Promise<void>> = [];

  set(ref: DocRef, data: Record<string, unknown>, opts?: { merge?: boolean }): WriteBatch {
    this.ops.push(async () => {
      await ref.set(data, opts);
    });
    return this;
  }

  update(ref: DocRef, data: Record<string, unknown>): WriteBatch {
    this.ops.push(async () => {
      await ref.update(data);
    });
    return this;
  }

  delete(ref: DocRef): WriteBatch {
    this.ops.push(async () => {
      await ref.delete();
    });
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.ops) await op();
    this.ops = [];
  }
}

class TransactionShim {
  async get(refOrQuery: DocRef | Query): Promise<DocSnapshot | QuerySnapshot> {
    return refOrQuery.get() as Promise<DocSnapshot | QuerySnapshot>;
  }
  set(ref: DocRef, data: Record<string, unknown>, opts?: { merge?: boolean }): TransactionShim {
    void ref.set(data, opts);
    return this;
  }
  update(ref: DocRef, data: Record<string, unknown>): TransactionShim {
    void ref.update(data);
    return this;
  }
  delete(ref: DocRef): TransactionShim {
    void ref.delete();
    return this;
  }
}

// ---------------------------------------------------------------------------
// Firestore facade
// ---------------------------------------------------------------------------

class FirestoreShim {
  collection(path: string): CollectionRef {
    return new CollectionRef(path);
  }

  doc(path: string): DocRef {
    const segs = path.split("/");
    if (segs.length < 2 || segs.length % 2 !== 0) {
      throw new Error(`selfhost firestore shim: invalid doc path '${path}'`);
    }
    const id = segs.pop()!;
    return new DocRef(segs.join("/"), id);
  }

  collectionGroup(_name: string): never {
    throw new Error("selfhost firestore shim: collectionGroup not implemented (spike)");
  }

  batch(): WriteBatch {
    return new WriteBatch();
  }

  async runTransaction<T>(fn: (tx: TransactionShim) => Promise<T>): Promise<T> {
    // Spike: no isolation — single-user, single-writer. Production wraps in PG tx.
    return fn(new TransactionShim());
  }

  async getAll(...refs: DocRef[]): Promise<DocSnapshot[]> {
    return Promise.all(refs.map((r) => r.get()));
  }

  async recursiveDelete(ref: DocRef | CollectionRef): Promise<void> {
    const pg = await getPg();
    const prefix = ref.path;
    await pg.query(`DELETE FROM docs WHERE path = $1 OR path LIKE $2 OR collection_path LIKE $3`, [
      prefix,
      `${prefix}/%`,
      `${prefix}%`,
    ]);
  }

  settings(_opts: unknown): void {}
}

const firestoreSingleton = new FirestoreShim();

export function getFirestore(): FirestoreShim {
  return firestoreSingleton;
}

export function initializeFirestore(): FirestoreShim {
  return firestoreSingleton;
}
