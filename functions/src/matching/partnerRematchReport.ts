/**
 * Partner re-match disagreement report (fork #86, piece 1).
 *
 * Runs the *current* partner matcher over transactions that already carry a
 * partner assignment and reports where its answer differs from what is stored.
 * It writes nothing — no transaction update, no `manualRemovals` entry, no
 * automation history. That is the point: `processPartnerMatchesForTransactions`
 * skips any transaction with a `partnerId`, and the only way to unblock that
 * guard today (`removePartnerFromTransaction`) records the pair as a false
 * positive and permanently vetoes it, so a bulk re-match would blacklist the
 * *correct* stale assignments along with the wrong ones. Until a re-match path
 * exists that does not record a false positive (#86, piece 2), this report is
 * how a human decides selectively.
 *
 * Matcher parity: candidates are filtered through the same `manualRemovals`
 * veto the write path applies, and a global top match is resolved to the local
 * partner the assignment path would localise it into, so a localisation is not
 * reported as a partner change.
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  matchTransaction,
  shouldAutoApply,
  AUTO_APPLY_THRESHOLD,
  MatchResult,
  PartnerData,
  TransactionData,
} from "../utils/partner-matcher";
import {
  loadPartnerMatchingContext,
  PartnerMatchingContext,
} from "./partnerMatchingShared";

const db = getFirestore();

const PAGE_SIZE = 500;
const DEFAULT_ROW_LIMIT = 50;
const MAX_ROW_LIMIT = 500;
/** Hard ceiling on documents scanned, so the report cannot run unbounded. */
const MAX_SCAN = 20000;
const DEFAULT_MATCHED_BY = ["auto", "ai"];

export type RematchVerdict =
  /** The matcher would now auto-apply a different partner. */
  | "different_partner"
  /** The matcher still ranks candidates, but none reach the auto-apply gate. */
  | "below_threshold"
  /** The matcher finds no candidate at all for this transaction. */
  | "no_candidates"
  /** The stored partner is not in the active partner list — nothing to compare. */
  | "stored_partner_unknown"
  /** The matcher would auto-apply exactly what is stored. */
  | "agrees"
  /**
   * Agrees, but only because the partner is a local copy of a global preset.
   * `GLOBAL_APPROXIMATE_NAME_CAP` applies to `partnerType: "global"` only, and
   * `createLocalPartnerFromGlobal` copies the preset's name and aliases into a
   * user partner, so approximate name evidence against that copy is no longer
   * capped and can reach the gate on its own. Agreement here is weaker evidence
   * than a plain `agrees` and still deserves human eyes.
   */
  | "agrees_via_localized_global_name";

const AGREEING_VERDICTS: ReadonlySet<RematchVerdict> = new Set<RematchVerdict>([
  "agrees",
  "agrees_via_localized_global_name",
]);

export function isDisagreement(verdict: RematchVerdict): boolean {
  return !AGREEING_VERDICTS.has(verdict);
}

export interface StoredAssignment {
  transactionId: string;
  partnerId: string;
  partnerType: string | null;
  confidence: number | null;
  matchedBy: string | null;
}

/** Lookups the classifier needs, derived from the matching context. */
export interface PartnerIndex {
  /** Every active partner the matcher can return, by id. */
  byId: Map<string, { partner: PartnerData; type: "global" | "user" }>;
  /** globalPartnerId -> the local user partner that already localises it. */
  localIdByGlobalId: Map<string, string>;
}

export function buildPartnerIndex(context: PartnerMatchingContext): PartnerIndex {
  const byId = new Map<string, { partner: PartnerData; type: "global" | "user" }>();
  const localIdByGlobalId = new Map<string, string>();

  for (const partner of context.userPartners) {
    byId.set(partner.id, { partner, type: "user" });
    if (partner.globalPartnerId) {
      localIdByGlobalId.set(partner.globalPartnerId, partner.id);
    }
  }
  for (const partner of context.filteredGlobalPartners) {
    byId.set(partner.id, { partner, type: "global" });
  }

  return { byId, localIdByGlobalId };
}

export interface CandidateView {
  partnerId: string;
  partnerName: string;
  partnerType: "global" | "user";
  confidence: number;
  source: MatchResult["source"];
  /** True when applying this match would create a new local partner document. */
  wouldCreateLocalPartner: boolean;
}

export interface RematchClassification {
  verdict: RematchVerdict;
  /** Partner id the matcher would store now, or null if it would assign nothing. */
  wouldAssignPartnerId: string | null;
  /** Top-ranked candidate, or null when the matcher returns nothing. */
  topCandidate: CandidateView | null;
  /** All candidates the matcher returns (it caps its own list at 3). */
  candidates: CandidateView[];
}

function toCandidateView(
  match: MatchResult,
  index: PartnerIndex
): CandidateView {
  const localised =
    match.partnerType === "global"
      ? index.localIdByGlobalId.get(match.partnerId)
      : undefined;

  return {
    partnerId: localised ?? match.partnerId,
    partnerName: match.partnerName,
    partnerType: match.partnerType,
    confidence: match.confidence,
    source: match.source,
    wouldCreateLocalPartner: match.partnerType === "global" && !localised,
  };
}

/**
 * Compare one stored assignment against the matcher's current answer.
 *
 * Pure — takes the matcher output, returns a verdict. `matches` must already
 * have the `manualRemovals` veto applied, exactly as the write path does.
 */
export function classifyRematch(
  stored: StoredAssignment,
  matches: MatchResult[],
  index: PartnerIndex
): RematchClassification {
  const candidates = matches.map((m) => toCandidateView(m, index));
  const topCandidate = candidates[0] ?? null;

  if (!index.byId.has(stored.partnerId)) {
    return {
      verdict: "stored_partner_unknown",
      wouldAssignPartnerId: null,
      topCandidate,
      candidates,
    };
  }

  if (!topCandidate) {
    return {
      verdict: "no_candidates",
      wouldAssignPartnerId: null,
      topCandidate: null,
      candidates,
    };
  }

  if (!shouldAutoApply(topCandidate.confidence)) {
    return {
      verdict: "below_threshold",
      wouldAssignPartnerId: null,
      topCandidate,
      candidates,
    };
  }

  if (topCandidate.wouldCreateLocalPartner ||
      topCandidate.partnerId !== stored.partnerId) {
    return {
      verdict: "different_partner",
      wouldAssignPartnerId: topCandidate.wouldCreateLocalPartner
        ? null
        : topCandidate.partnerId,
      topCandidate,
      candidates,
    };
  }

  const storedPartner = index.byId.get(stored.partnerId)!;
  const localisedFromGlobal =
    storedPartner.type === "user" && Boolean(storedPartner.partner.globalPartnerId);

  return {
    verdict:
      localisedFromGlobal && topCandidate.source === "name"
        ? "agrees_via_localized_global_name"
        : "agrees",
    wouldAssignPartnerId: topCandidate.partnerId,
    topCandidate,
    candidates,
  };
}

/**
 * Score the stored partner on its own, so a `different_partner` row can still
 * say what the stored answer is worth now. `matchTransaction` caps its result
 * list at 3, so the stored partner is not always in `candidates`.
 */
export function scoreStoredPartner(
  transaction: TransactionData,
  stored: StoredAssignment,
  index: PartnerIndex
): number | null {
  const entry = index.byId.get(stored.partnerId);
  if (!entry) return null;

  const [match] =
    entry.type === "user"
      ? matchTransaction(transaction, [entry.partner], [])
      : matchTransaction(transaction, [], [entry.partner]);

  return match ? match.confidence : null;
}

export interface RematchRow {
  transactionId: string;
  verdict: RematchVerdict;
  date: string | null;
  amount: number | null;
  /** Bank-statement text the matcher reads. */
  transactionName: string;
  transactionPartnerText: string | null;
  storedPartnerId: string;
  storedPartnerName: string | null;
  storedConfidence: number | null;
  storedMatchedBy: string | null;
  /** When the auto-assignment ran, from `automationHistory`; null if not recorded. */
  assignedAt: string | null;
  /** What the stored partner scores under the current matcher, or null. */
  storedPartnerConfidenceNow: number | null;
  wouldAssignPartnerId: string | null;
  topCandidate: CandidateView | null;
  candidates: CandidateView[];
}

export interface PartnerRematchReportOptions {
  /** Only stored assignments at or above this confidence. */
  minConfidence?: number;
  /** Only stored assignments at or below this confidence. */
  maxConfidence?: number;
  /** Only assignments recorded before this instant (ISO 8601). */
  assignedBefore?: string;
  /** Which `partnerMatchedBy` values to consider. Default: auto + ai. */
  matchedBy?: string[];
  /** Cap on returned rows. Counts always cover the whole scanned population. */
  limit?: number;
  /** Include agreeing transactions in `rows` too. Default: disagreements only. */
  includeAgreements?: boolean;
}

export interface PartnerRematchReport {
  /** Nothing was written. Present so a caller cannot mistake this for a fix. */
  readOnly: true;
  autoApplyThreshold: number;
  /** Transactions read. */
  scanned: number;
  /** Transactions carrying a partner assignment. */
  assigned: number;
  /** Assignments that passed the filters and were re-run. */
  evaluated: number;
  /** Verdict counts over every evaluated transaction, not over `rows`. */
  counts: Record<RematchVerdict, number>;
  disagreements: number;
  /** True when `rows` was cut by `limit`; counts above are still complete. */
  truncated: boolean;
  rows: RematchRow[];
  filters: {
    minConfidence: number | null;
    maxConfidence: number | null;
    assignedBefore: string | null;
    matchedBy: string[];
    includeAgreements: boolean;
    limit: number;
  };
  /** Set when the scan hit `MAX_SCAN` — the population is only partly covered. */
  scanLimitReached?: true;
}

function emptyCounts(): Record<RematchVerdict, number> {
  return {
    different_partner: 0,
    below_threshold: 0,
    no_candidates: 0,
    stored_partner_unknown: 0,
    agrees: 0,
    agrees_via_localized_global_name: 0,
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  const ts = value as Timestamp;
  if (typeof ts.toDate === "function") {
    const date = ts.toDate();
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/**
 * When the partner was auto-assigned, read off the last `partner_assigned`
 * entry in `automationHistory`. Null when the history predates that entry —
 * such a transaction is *older* than the recorded ones, never newer, so an
 * `assignedBefore` filter keeps it rather than dropping it silently.
 */
export function readAssignedAt(automationHistory: unknown): string | null {
  if (!Array.isArray(automationHistory)) return null;

  let latest: string | null = null;
  for (const entry of automationHistory) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; ranAt?: unknown };
    if (candidate.type !== "partner_assigned") continue;
    const ranAt = toIso(candidate.ranAt);
    if (!ranAt) continue;
    if (!latest || ranAt > latest) latest = ranAt;
  }
  return latest;
}

export async function buildPartnerRematchReport(
  userId: string,
  options: PartnerRematchReportOptions = {}
): Promise<PartnerRematchReport> {
  const matchedBy =
    options.matchedBy && options.matchedBy.length > 0
      ? options.matchedBy
      : DEFAULT_MATCHED_BY;
  const matchedByFilter = new Set(matchedBy);
  const limit = Math.min(
    Math.max(1, options.limit ?? DEFAULT_ROW_LIMIT),
    MAX_ROW_LIMIT
  );
  const minConfidence = options.minConfidence ?? null;
  const maxConfidence = options.maxConfidence ?? null;
  const assignedBefore = options.assignedBefore ?? null;
  const includeAgreements = options.includeAgreements ?? false;

  const partnerContext = await loadPartnerMatchingContext(userId);
  const index = buildPartnerIndex(partnerContext);

  const counts = emptyCounts();
  const rows: RematchRow[] = [];
  let scanned = 0;
  let assigned = 0;
  let evaluated = 0;
  let disagreements = 0;
  let truncated = false;
  let scanLimitReached = false;

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let query = db
      .collection("transactions")
      .where("userId", "==", userId)
      .orderBy("__name__")
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const txDoc of snapshot.docs) {
      scanned++;
      const txData = txDoc.data();
      const storedPartnerId = txData.partnerId;
      if (!storedPartnerId || typeof storedPartnerId !== "string") continue;
      assigned++;

      const storedMatchedBy =
        typeof txData.partnerMatchedBy === "string" ? txData.partnerMatchedBy : null;
      if (!storedMatchedBy || !matchedByFilter.has(storedMatchedBy)) continue;

      const storedConfidence =
        typeof txData.partnerMatchConfidence === "number"
          ? txData.partnerMatchConfidence
          : null;
      if (minConfidence !== null &&
          (storedConfidence === null || storedConfidence < minConfidence)) {
        continue;
      }
      if (maxConfidence !== null &&
          (storedConfidence === null || storedConfidence > maxConfidence)) {
        continue;
      }

      const assignedAt = readAssignedAt(txData.automationHistory);
      if (assignedBefore !== null && assignedAt !== null && assignedAt >= assignedBefore) {
        continue;
      }

      const stored: StoredAssignment = {
        transactionId: txDoc.id,
        partnerId: storedPartnerId,
        partnerType:
          typeof txData.partnerType === "string" ? txData.partnerType : null,
        confidence: storedConfidence,
        matchedBy: storedMatchedBy,
      };

      const transaction: TransactionData = {
        id: txDoc.id,
        partner: txData.partner || null,
        partnerIban: txData.partnerIban || null,
        name: txData.name || "",
        reference: txData.reference || null,
      };

      // Same veto the write path applies, so the report cannot claim a match
      // the matcher would refuse to make.
      const matches = matchTransaction(
        transaction,
        partnerContext.userPartners,
        partnerContext.filteredGlobalPartners
      ).filter((m) => {
        const removals = partnerContext.partnerManualRemovals.get(m.partnerId);
        return !(removals && removals.has(txDoc.id));
      });

      const classification = classifyRematch(stored, matches, index);
      evaluated++;
      counts[classification.verdict]++;

      const disagrees = isDisagreement(classification.verdict);
      if (disagrees) disagreements++;

      if (!disagrees && !includeAgreements) continue;

      if (rows.length >= limit) {
        truncated = true;
        continue;
      }

      rows.push({
        transactionId: txDoc.id,
        verdict: classification.verdict,
        date: toIso(txData.date)?.slice(0, 10) ?? null,
        amount: typeof txData.amount === "number" ? txData.amount : null,
        transactionName: transaction.name,
        transactionPartnerText: transaction.partner,
        storedPartnerId,
        storedPartnerName: partnerContext.partnerNameMap.get(storedPartnerId) ?? null,
        storedConfidence,
        storedMatchedBy,
        assignedAt,
        storedPartnerConfidenceNow: scoreStoredPartner(transaction, stored, index),
        wouldAssignPartnerId: classification.wouldAssignPartnerId,
        topCandidate: classification.topCandidate,
        candidates: classification.candidates,
      });
    }

    if (snapshot.size < PAGE_SIZE) break;
    if (scanned >= MAX_SCAN) {
      scanLimitReached = true;
      break;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }

  return {
    readOnly: true,
    autoApplyThreshold: AUTO_APPLY_THRESHOLD,
    scanned,
    assigned,
    evaluated,
    counts,
    disagreements,
    truncated,
    rows,
    filters: {
      minConfidence,
      maxConfidence,
      assignedBefore,
      matchedBy,
      includeAgreements,
      limit,
    },
    ...(scanLimitReached ? { scanLimitReached: true as const } : {}),
  };
}
