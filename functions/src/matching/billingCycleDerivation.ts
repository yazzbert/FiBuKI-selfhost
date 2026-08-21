/**
 * Billing cycle — shared, pure derivation.
 *
 * Ported unchanged out of the learnBillingCycle callable (which now only does
 * the Firestore I/O around it), so the post-connect trigger, the nightly
 * schedule and the MCP surface all derive a cycle the same way.
 *
 * Algorithm (unchanged from the callable, extended by the band split):
 * 1. Split the partner's transactions into amount bands
 * 2. Per band: compute inter-transaction intervals (days between consecutive
 *    transactions)
 * 3. Find the mode interval (most common, within +/- 5 day tolerance)
 * 4. If mode has 3+ occurrences and covers >50% of intervals -> detected cycle
 * 5. Compute typical day-of-month from the band's transaction dates
 * 6. If the band's transactions carry connected invoice dates, compute the
 *    invoice-to-transaction delay
 *
 * The band split is the extension: a partner that bills 38.25 weekly and 90
 * monthly is two recurrences, not one noisy history. A partner whose amounts
 * never settle into a band falls back to the whole history, which is exactly
 * what the callable did before.
 *
 * Times are plain Dates in here — nothing in this module touches Firestore.
 * The stored shape (Timestamps) is described in types/partner.ts; keep the two
 * in sync.
 */

// === Configuration ===

export const BILLING_CYCLE_CONFIG = {
  /** Fewest transactions a partner needs before anything is derived */
  MIN_TRANSACTIONS: 3,
  /** Fewest transactions a band needs to count as its own recurrence */
  MIN_BAND_TRANSACTIONS: 3,
  /** Interval tolerance in days when looking for the mode */
  INTERVAL_TOLERANCE_DAYS: 5,
  /** Mode must occur this often AND cover this share of the intervals */
  MIN_MODE_COUNT: 3,
  MIN_MODE_SHARE: 0.5,
  /** Fewest invoice delays before the delay fields are learned */
  MIN_DELAY_SAMPLES: 3,
  /**
   * Two amounts belong to the same band when they are within this share of the
   * band's first amount. 15% absorbs the FX drift of a USD subscription billed
   * in EUR while keeping Anthropic's 38.25 weekly apart from its 90 monthly.
   */
  BAND_RELATIVE_TOLERANCE: 0.15,
  /** Floor for the relative tolerance, so near-zero amounts still group */
  BAND_ABSOLUTE_TOLERANCE: 1,
  /** Transactions per partner the learner looks at */
  MAX_TRANSACTIONS: 100,
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const CADENCE_DAYS: Record<Exclude<BillingCadence, "custom">, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

// === Types ===

/** ISO-4217 code plus the amount range a recurrence bills in. */
export interface BillingAmountBand {
  /** Lowest absolute amount seen in the band (inclusive) */
  min: number;
  /** Highest absolute amount seen in the band (inclusive) */
  max: number;
  /** Currency the band is expressed in */
  currency: string;
}

export type BillingCadence = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

/** What the partner is expected to produce for each charge. */
export type BillingDocumentExpectation = "invoice" | "no_receipt_category" | "none";

/** What Fibuki worked out from the history of one amount band. */
export interface LearnedBillingCycle {
  /** Average interval in days between transactions (e.g., 30, 90, 365) */
  frequencyDays: number;
  /** Confidence score (0-100) based on consistency of intervals */
  frequencyConfidence: number;
  /** Most common day-of-month for transactions (1-31) */
  typicalDayOfMonth?: number;
  /** Typical variance in days from the expected date */
  dayVariance?: number;
  /** Average delay in days from invoice date to transaction date */
  invoiceToTransactionDelay?: number;
  /** Variance of the invoice-to-transaction delay */
  delayVariance?: number;
  /** Number of transactions in this band used to compute the cycle */
  sampleSize: number;
  /** When the derivation last ran */
  learnedAt: Date;
  /** The band this recurrence covers */
  amountBand?: BillingAmountBand;
}

/** What the user stated by hand. Wins over the learned half. */
export interface DeclaredBillingCycle {
  cadence: BillingCadence;
  /** Days between charges — derived from `cadence` unless it is "custom" */
  frequencyDays: number;
  typicalDayOfMonth?: number;
  /** Expected amount band in the billed currency (a USD subscription stays one recurrence) */
  expectedAmount?: BillingAmountBand;
  documentExpectation: BillingDocumentExpectation;
  declaredAt?: Date;
}

/** The declared half resolved over the learned one, field by field. */
export interface EffectiveBillingCycle {
  source: "declared" | "learned";
  frequencyDays: number;
  frequencyConfidence?: number;
  typicalDayOfMonth?: number;
  dayVariance?: number;
  invoiceToTransactionDelay?: number;
  delayVariance?: number;
  amountBand?: BillingAmountBand;
  documentExpectation: BillingDocumentExpectation;
}

/** One recurrence of a partner, keyed by the amount band it bills in. */
export interface BillingRecurrence {
  /** Human-readable band key ("EUR:38-39"); "default" when there is no band */
  bandKey: string;
  learned?: LearnedBillingCycle;
  declared?: DeclaredBillingCycle;
  effective?: EffectiveBillingCycle;
}

/**
 * The partner's whole billing knowledge. `learned` / `declared` / `effective`
 * are the primary recurrence's halves; `recurrences` carries all of them, the
 * primary first. A partner with one cadence has exactly one recurrence — that
 * is the single-cycle shape this replaced.
 */
export interface BillingCycleStructure {
  learned?: LearnedBillingCycle;
  declared?: DeclaredBillingCycle;
  effective?: EffectiveBillingCycle;
  recurrences: BillingRecurrence[];
}

/** One transaction of the partner, as the derivation needs it. */
export interface BillingCycleTransaction {
  id: string;
  date: Date;
  /** Signed amount as booked; the band split uses the absolute value */
  amount?: number;
  currency?: string;
}

/** Extracted date of a file connected to one of those transactions. */
export interface BillingCycleInvoiceDate {
  transactionId: string;
  invoiceDate: Date;
}

export interface BillingCycleInput {
  /** The partner's transactions — read by `partnerId` only, never `bankPartnerId` */
  transactions: BillingCycleTransaction[];
  /** Dates of connected invoice files, when any are known */
  connectedInvoiceDates?: BillingCycleInvoiceDate[];
  /** Stamped onto every learned half; passed in so the derivation stays pure */
  now: Date;
}

// === Derivation ===

/**
 * Derive the learned half of a partner's billing cycle, one entry per amount
 * band, ordered primary (largest sample) first. Empty when nothing recurs.
 */
export function deriveBillingCycle(input: BillingCycleInput): LearnedBillingCycle[] {
  const transactions = [...input.transactions]
    .filter((tx) => tx.date instanceof Date && !Number.isNaN(tx.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (transactions.length < BILLING_CYCLE_CONFIG.MIN_TRANSACTIONS) {
    return [];
  }

  // Bands too thin to stand on their own are not recurrences. When none
  // qualifies the whole history is one band, which is what the callable did
  // before the split existed.
  let bands = splitByAmountBand(transactions).filter(
    (band) => band.length >= BILLING_CYCLE_CONFIG.MIN_BAND_TRANSACTIONS
  );
  if (bands.length === 0) {
    bands = [transactions];
  }

  const learned = bands
    .map((band) => deriveBandCycle(band, input.connectedInvoiceDates ?? [], input.now))
    .filter((cycle): cycle is LearnedBillingCycle => cycle !== null);

  // Primary first: the band with the most history, then the more confident one,
  // then the cheaper one — a total order, so re-learns stay stable.
  learned.sort(
    (a, b) =>
      b.sampleSize - a.sampleSize ||
      b.frequencyConfidence - a.frequencyConfidence ||
      (a.amountBand?.min ?? 0) - (b.amountBand?.min ?? 0)
  );

  return learned;
}

/**
 * Split transactions into amount bands. Amounts are sorted, and a band ends
 * where the gap from its first amount exceeds the tolerance — chaining a whole
 * history into one band through a ladder of small steps is exactly what we do
 * not want.
 */
export function splitByAmountBand(
  transactions: BillingCycleTransaction[]
): BillingCycleTransaction[][] {
  const withAmount = transactions.filter((tx) => typeof tx.amount === "number");
  if (withAmount.length !== transactions.length) {
    // A history that does not carry amounts everywhere cannot be banded.
    return [transactions];
  }

  const sorted = [...transactions].sort(
    (a, b) => Math.abs(a.amount!) - Math.abs(b.amount!)
  );

  const bands: BillingCycleTransaction[][] = [];
  let current: BillingCycleTransaction[] = [];
  let anchor = 0;

  for (const tx of sorted) {
    const amount = Math.abs(tx.amount!);
    if (current.length === 0) {
      current = [tx];
      anchor = amount;
      continue;
    }
    const tolerance = Math.max(
      BILLING_CYCLE_CONFIG.BAND_ABSOLUTE_TOLERANCE,
      anchor * BILLING_CYCLE_CONFIG.BAND_RELATIVE_TOLERANCE
    );
    if (amount - anchor <= tolerance) {
      current.push(tx);
    } else {
      bands.push(current);
      current = [tx];
      anchor = amount;
    }
  }
  if (current.length > 0) bands.push(current);

  // Each band back in date order — the interval walk depends on it.
  return bands.map((band) => [...band].sort((a, b) => a.date.getTime() - b.date.getTime()));
}

/**
 * The original single-history algorithm, now run per band.
 */
function deriveBandCycle(
  band: BillingCycleTransaction[],
  invoiceDates: BillingCycleInvoiceDate[],
  now: Date
): LearnedBillingCycle | null {
  const txDates = band.map((tx) => tx.date);
  const intervals: number[] = [];

  for (let i = 1; i < txDates.length; i++) {
    const daysDiff = Math.round(
      (txDates[i].getTime() - txDates[i - 1].getTime()) / MS_PER_DAY
    );
    if (daysDiff > 0) {
      intervals.push(daysDiff);
    }
  }

  if (intervals.length < 2) return null;

  const result = findModeInterval(intervals, BILLING_CYCLE_CONFIG.INTERVAL_TOLERANCE_DAYS);
  if (!result) return null;

  const { modeInterval, count, matchingIntervals } = result;

  // Require mode to have 3+ occurrences and cover >50% of intervals
  if (
    count < BILLING_CYCLE_CONFIG.MIN_MODE_COUNT ||
    count / intervals.length < BILLING_CYCLE_CONFIG.MIN_MODE_SHARE
  ) {
    return null;
  }

  // Compute frequency confidence based on consistency
  const consistencyRatio = count / intervals.length;
  const avgDeviation =
    matchingIntervals.reduce((sum, i) => sum + Math.abs(i - modeInterval), 0) /
    matchingIntervals.length;
  const frequencyConfidence = Math.min(
    100,
    Math.round(consistencyRatio * 80 + Math.max(0, 20 - avgDeviation * 2))
  );

  // Compute typical day-of-month
  const daysOfMonth = txDates.map((d) => d.getDate());
  const typicalDayOfMonth = computeMode(daysOfMonth);

  // Compute day variance (standard deviation of days-of-month)
  const dayMean = daysOfMonth.reduce((s, d) => s + d, 0) / daysOfMonth.length;
  const dayVariance = Math.round(
    Math.sqrt(
      daysOfMonth.reduce((s, d) => s + (d - dayMean) ** 2, 0) / daysOfMonth.length
    )
  );

  const delays = computeInvoiceDelays(band, invoiceDates);
  let invoiceToTransactionDelay: number | undefined;
  let delayVariance: number | undefined;
  if (delays.length >= BILLING_CYCLE_CONFIG.MIN_DELAY_SAMPLES) {
    invoiceToTransactionDelay = Math.round(
      delays.reduce((s, d) => s + d, 0) / delays.length
    );
    delayVariance = Math.round(
      Math.sqrt(
        delays.reduce((s, d) => s + (d - invoiceToTransactionDelay!) ** 2, 0) / delays.length
      )
    );
  }

  const amountBand = amountBandOf(band);

  return {
    frequencyDays: modeInterval,
    frequencyConfidence,
    typicalDayOfMonth,
    dayVariance,
    // Omitted entirely when unlearned (<3 delays): Firestore rejects
    // undefined values, and ignoreUndefinedProperties is never enabled.
    ...(invoiceToTransactionDelay !== undefined
      ? { invoiceToTransactionDelay, delayVariance }
      : {}),
    sampleSize: band.length,
    learnedAt: now,
    ...(amountBand ? { amountBand } : {}),
  };
}

/** Days between each connected invoice date and its transaction. */
function computeInvoiceDelays(
  band: BillingCycleTransaction[],
  invoiceDates: BillingCycleInvoiceDate[]
): number[] {
  const byId = new Map(band.map((tx) => [tx.id, tx]));
  const delays: number[] = [];

  for (const { transactionId, invoiceDate } of invoiceDates) {
    const tx = byId.get(transactionId);
    if (!tx) continue;
    delays.push(Math.round((tx.date.getTime() - invoiceDate.getTime()) / MS_PER_DAY));
  }

  return delays;
}

/** The amount range and currency a band bills in. */
function amountBandOf(band: BillingCycleTransaction[]): BillingAmountBand | null {
  const amounts = band
    .map((tx) => tx.amount)
    .filter((a): a is number => typeof a === "number")
    .map(Math.abs);
  if (amounts.length === 0) return null;

  return {
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    currency: computeStringMode(band.map((tx) => tx.currency).filter(Boolean) as string[]) ?? "EUR",
  };
}

/**
 * Find the most common interval within tolerance.
 */
export function findModeInterval(
  intervals: number[],
  tolerance: number
): { modeInterval: number; count: number; matchingIntervals: number[] } | null {
  if (intervals.length === 0) return null;

  // Group intervals by buckets (using tolerance)
  let bestMode = 0;
  let bestCount = 0;
  let bestMatching: number[] = [];

  // Test each interval as a potential center
  const sorted = [...intervals].sort((a, b) => a - b);
  const tested = new Set<number>();

  for (const center of sorted) {
    // Round to nearest 5 to avoid testing too many centers
    const rounded = Math.round(center / 5) * 5 || center;
    if (tested.has(rounded)) continue;
    tested.add(rounded);

    const matching = intervals.filter(
      (i) => Math.abs(i - rounded) <= tolerance
    );

    if (matching.length > bestCount) {
      bestCount = matching.length;
      bestMode = rounded;
      bestMatching = matching;
    }
  }

  // Also test common billing periods
  for (const period of [7, 14, 30, 60, 90, 180, 365]) {
    const matching = intervals.filter(
      (i) => Math.abs(i - period) <= tolerance
    );
    if (matching.length >= bestCount) {
      bestCount = matching.length;
      bestMode = period;
      bestMatching = matching;
    }
  }

  if (bestCount === 0) return null;

  return { modeInterval: bestMode, count: bestCount, matchingIntervals: bestMatching };
}

/**
 * Compute the mode (most frequent value) of a number array.
 */
export function computeMode(values: number[]): number {
  const freq = new Map<number, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) || 0) + 1);
  }
  let mode = values[0];
  let maxFreq = 0;
  for (const [val, count] of freq) {
    if (count > maxFreq) {
      maxFreq = count;
      mode = val;
    }
  }
  return mode;
}

function computeStringMode(values: string[]): string | null {
  if (values.length === 0) return null;
  const freq = new Map<string, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) || 0) + 1);
  }
  let mode = values[0];
  let maxFreq = 0;
  for (const [val, count] of freq) {
    if (count > maxFreq) {
      maxFreq = count;
      mode = val;
    }
  }
  return mode;
}

// === Declared / effective resolution ===

/** Days between charges for a declared cadence. */
export function cadenceToFrequencyDays(
  cadence: BillingCadence,
  frequencyDays?: number
): number {
  if (cadence === "custom") return frequencyDays ?? 0;
  return CADENCE_DAYS[cadence];
}

/**
 * Resolve the declared half over the learned one. The declared half only
 * carries what a user can reasonably state; everything else (variances, the
 * invoice delay) still comes from what was learned.
 */
export function resolveEffectiveCycle(
  learned?: LearnedBillingCycle,
  declared?: DeclaredBillingCycle
): EffectiveBillingCycle | undefined {
  if (declared) {
    const frequencyDays =
      cadenceToFrequencyDays(declared.cadence, declared.frequencyDays) ||
      learned?.frequencyDays ||
      0;
    if (frequencyDays <= 0) return undefined;
    return {
      source: "declared",
      frequencyDays,
      ...(learned?.frequencyConfidence !== undefined
        ? { frequencyConfidence: learned.frequencyConfidence }
        : {}),
      ...pickDefined("typicalDayOfMonth", declared.typicalDayOfMonth ?? learned?.typicalDayOfMonth),
      ...pickDefined("dayVariance", learned?.dayVariance),
      ...pickDefined("invoiceToTransactionDelay", learned?.invoiceToTransactionDelay),
      ...pickDefined("delayVariance", learned?.delayVariance),
      ...pickDefined("amountBand", declared.expectedAmount ?? learned?.amountBand),
      documentExpectation: declared.documentExpectation,
    };
  }

  if (!learned) return undefined;

  return {
    source: "learned",
    frequencyDays: learned.frequencyDays,
    frequencyConfidence: learned.frequencyConfidence,
    ...pickDefined("typicalDayOfMonth", learned.typicalDayOfMonth),
    ...pickDefined("dayVariance", learned.dayVariance),
    ...pickDefined("invoiceToTransactionDelay", learned.invoiceToTransactionDelay),
    ...pickDefined("delayVariance", learned.delayVariance),
    ...pickDefined("amountBand", learned.amountBand),
    // Nothing declared: a partner that bills is expected to invoice.
    documentExpectation: "invoice",
  };
}

function pickDefined<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** Stable, readable key for a band; "default" when the band is unknown. */
export function bandKeyOf(band?: BillingAmountBand): string {
  if (!band) return "default";
  return `${band.currency}:${Math.round(band.min)}-${Math.round(band.max)}`;
}

/** Do two bands describe the same recurrence? */
export function bandsOverlap(a?: BillingAmountBand, b?: BillingAmountBand): boolean {
  // An unbanded recurrence is the whole history — it covers everything.
  if (!a || !b) return true;
  if (a.currency !== b.currency) return false;
  return a.min <= b.max && b.min <= a.max;
}

/**
 * Fold a freshly derived learned half into what the partner already carries.
 *
 * A declared cycle is the user's word and survives every re-learn, re-match and
 * re-extraction: it is carried over onto the recurrence whose band it covers,
 * and kept as a declared-only recurrence when its band no longer shows history
 * (or never did — a vendor can be declared recurring from day one).
 */
export function mergeBillingCycle(
  existing: BillingCycleStructure | null | undefined,
  derived: LearnedBillingCycle[]
): BillingCycleStructure | null {
  const declaredHalves = (existing?.recurrences ?? [])
    .map((r) => r.declared)
    .filter((d): d is DeclaredBillingCycle => !!d);

  const unclaimed = [...declaredHalves];

  const recurrences: BillingRecurrence[] = derived.map((learned) => {
    const idx = unclaimed.findIndex((d) =>
      bandsOverlap(d.expectedAmount, learned.amountBand)
    );
    const declared = idx >= 0 ? unclaimed.splice(idx, 1)[0] : undefined;
    return {
      bandKey: bandKeyOf(learned.amountBand),
      learned,
      ...(declared ? { declared } : {}),
      ...withEffective(learned, declared),
    };
  });

  // Declared bands with no history of their own stay recurrences in their own right.
  for (const declared of unclaimed) {
    recurrences.push({
      bandKey: bandKeyOf(declared.expectedAmount),
      declared,
      ...withEffective(undefined, declared),
    });
  }

  if (recurrences.length === 0) return null;

  const primary = recurrences[0];
  return {
    ...(primary.learned ? { learned: primary.learned } : {}),
    ...(primary.declared ? { declared: primary.declared } : {}),
    ...(primary.effective ? { effective: primary.effective } : {}),
    recurrences,
  };
}

function withEffective(
  learned?: LearnedBillingCycle,
  declared?: DeclaredBillingCycle
): { effective?: EffectiveBillingCycle } {
  const effective = resolveEffectiveCycle(learned, declared);
  return effective ? { effective } : {};
}

// === Stored shape <-> structure ===

/** Firestore Timestamp, Date, ISO string or epoch millis — all read the same. */
function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function readBand(raw: unknown): BillingAmountBand | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const min = num(r.min);
  const max = num(r.max);
  if (min === undefined || max === undefined) return undefined;
  return { min, max, currency: typeof r.currency === "string" ? r.currency : "EUR" };
}

function readLearned(raw: unknown): LearnedBillingCycle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const frequencyDays = num(r.frequencyDays);
  if (frequencyDays === undefined) return undefined;
  const band = readBand(r.amountBand);
  return {
    frequencyDays,
    frequencyConfidence: num(r.frequencyConfidence) ?? 0,
    ...pickDefined("typicalDayOfMonth", num(r.typicalDayOfMonth)),
    ...pickDefined("dayVariance", num(r.dayVariance)),
    ...pickDefined("invoiceToTransactionDelay", num(r.invoiceToTransactionDelay)),
    ...pickDefined("delayVariance", num(r.delayVariance)),
    sampleSize: num(r.sampleSize) ?? 0,
    learnedAt: toDate(r.learnedAt) ?? toDate(r.updatedAt) ?? new Date(0),
    ...(band ? { amountBand: band } : {}),
  };
}

function readDeclared(raw: unknown): DeclaredBillingCycle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const cadence = (typeof r.cadence === "string" ? r.cadence : "custom") as BillingCadence;
  const frequencyDays = cadenceToFrequencyDays(cadence, num(r.frequencyDays));
  if (!frequencyDays) return undefined;
  const expectedAmount = readBand(r.expectedAmount);
  const declaredAt = toDate(r.declaredAt);
  const expectation = r.documentExpectation;
  return {
    cadence,
    frequencyDays,
    ...pickDefined("typicalDayOfMonth", num(r.typicalDayOfMonth)),
    ...(expectedAmount ? { expectedAmount } : {}),
    documentExpectation:
      expectation === "no_receipt_category" || expectation === "none"
        ? expectation
        : "invoice",
    ...(declaredAt ? { declaredAt } : {}),
  };
}

/**
 * Read whatever is stored on a partner into the structure.
 *
 * Accepts the pre-split single-cycle shape (flat frequency fields on
 * `billingCycle`) and reads it as the one-band case, so partners learned
 * before this change keep their cycle without a migration.
 */
export function normalizeBillingCycle(raw: unknown): BillingCycleStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const storedRecurrences = Array.isArray(r.recurrences) ? r.recurrences : null;
  const halves: Array<{ learned?: LearnedBillingCycle; declared?: DeclaredBillingCycle }> =
    storedRecurrences
      ? storedRecurrences.map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>;
          return { learned: readLearned(e.learned), declared: readDeclared(e.declared) };
        })
      : [
          {
            // The pre-split shape put the learned fields directly on billingCycle.
            learned: readLearned(r.learned ?? r),
            declared: readDeclared(r.declared),
          },
        ];

  const recurrences: BillingRecurrence[] = halves
    .filter((h) => h.learned || h.declared)
    .map((h) => ({
      bandKey: bandKeyOf(h.declared?.expectedAmount ?? h.learned?.amountBand),
      ...(h.learned ? { learned: h.learned } : {}),
      ...(h.declared ? { declared: h.declared } : {}),
      ...withEffective(h.learned, h.declared),
    }));

  if (recurrences.length === 0) return null;

  const primary = recurrences[0];
  return {
    ...(primary.learned ? { learned: primary.learned } : {}),
    ...(primary.declared ? { declared: primary.declared } : {}),
    ...(primary.effective ? { effective: primary.effective } : {}),
    recurrences,
  };
}

/**
 * Serialize the structure for storage.
 *
 * The primary recurrence's effective fields are mirrored flat onto the root:
 * every reader written before the split (matchFileTransactions,
 * aggregateGlobalInsights, the agent tools, the worker chat) reads them there,
 * and they keep working untouched until #167-#171 move them onto `effective`.
 * Undefined fields are omitted rather than written — firebase-admin rejects
 * undefined, and `ignoreUndefinedProperties` is never enabled.
 */
export function toStoredBillingCycle<T>(
  structure: BillingCycleStructure,
  toTimestamp: (date: Date) => T,
  now: Date
): Record<string, unknown> {
  const primary = structure.recurrences[0];
  const effective = primary?.effective;

  return {
    // --- legacy single-cycle mirror ---
    frequencyDays: effective?.frequencyDays ?? primary?.learned?.frequencyDays ?? 0,
    // A declaration is the user's word: certain, even with no history behind it.
    frequencyConfidence:
      effective?.frequencyConfidence ?? (effective?.source === "declared" ? 100 : 0),
    ...pickDefined("typicalDayOfMonth", effective?.typicalDayOfMonth),
    ...pickDefined("dayVariance", effective?.dayVariance),
    ...pickDefined("invoiceToTransactionDelay", effective?.invoiceToTransactionDelay),
    ...pickDefined("delayVariance", effective?.delayVariance),
    sampleSize: primary?.learned?.sampleSize ?? 0,
    updatedAt: toTimestamp(now),
    // --- the split ---
    ...(structure.learned ? { learned: storeLearned(structure.learned, toTimestamp) } : {}),
    ...(structure.declared ? { declared: storeDeclared(structure.declared, toTimestamp) } : {}),
    ...(structure.effective ? { effective: structure.effective } : {}),
    recurrences: structure.recurrences.map((r) => ({
      bandKey: r.bandKey,
      ...(r.learned ? { learned: storeLearned(r.learned, toTimestamp) } : {}),
      ...(r.declared ? { declared: storeDeclared(r.declared, toTimestamp) } : {}),
      ...(r.effective ? { effective: r.effective } : {}),
    })),
  };
}

function storeLearned<T>(
  learned: LearnedBillingCycle,
  toTimestamp: (date: Date) => T
): Record<string, unknown> {
  return { ...learned, learnedAt: toTimestamp(learned.learnedAt) };
}

function storeDeclared<T>(
  declared: DeclaredBillingCycle,
  toTimestamp: (date: Date) => T
): Record<string, unknown> {
  return {
    ...declared,
    ...(declared.declaredAt ? { declaredAt: toTimestamp(declared.declaredAt) } : {}),
  };
}
