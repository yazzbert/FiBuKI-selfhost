/**
 * Transaction-suggestion dismissal, shared by the callable and the MCP tools.
 *
 * The callable (dismissTransactionSuggestion) drives the UI's dismiss action;
 * the tool handlers of the same name drive the MCP surface. Both must write the
 * identical field set, or a pair rejected by an agent and a pair rejected by a
 * click end up in different states and the learning export reads two different
 * histories — so the update objects are built here and nowhere else.
 *
 * Mirrors files/notInvoiceOps, which shares the mark/unmark builders the same
 * way (fork #61).
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";

/** Free text stored with a rejection. Longer than this is refused, not truncated. */
export const MAX_DISMISSAL_REASON_LENGTH = 500;

export interface TransactionSuggestion {
  transactionId: string;
  confidence: number;
  matchSources?: Array<{
    type: string;
    weight: number;
    details?: string;
  }>;
  suggestedAt?: unknown;
}

export interface DismissedTransactionEntry {
  transactionId: string;
  dismissedAt: unknown;
  confidence?: number | null;
  /** Free text from the rejecting agent. Absent on every record written before fork #93. */
  reason?: string | null;
}

/**
 * Fields the dismissal reads. Deliberately narrow: everything else on the file
 * document is irrelevant to the decision.
 */
export interface DismissibleFileState {
  transactionSuggestions?: TransactionSuggestion[];
  /** @deprecated legacy string[] kept in step with dismissedTransactions */
  dismissedTransactionIds?: string[];
  dismissedTransactions?: DismissedTransactionEntry[];
}

export interface DismissSuggestionOutcome {
  updates: Record<string, unknown>;
  /**
   * Confidence of the suggestion that was removed, or null when the pair was
   * not currently suggested — which is the normal case on a sweep re-run.
   */
  dismissedConfidence: number | null;
  /** True when the pair was already on the blacklist before this call. */
  alreadyDismissed: boolean;
}

export interface UndismissSuggestionOutcome {
  updates: Record<string, unknown>;
  wasDismissed: boolean;
}

/**
 * Validate a caller-supplied rejection reason without deciding how to complain
 * about it: the callable answers in HttpsError codes and the tool handler in
 * plain errors, but the rule they enforce has to be the one rule.
 *
 * Returns the message to reject with, or null when the reason is acceptable.
 * `null`/`undefined` are acceptable — a rejection needs no explanation.
 */
export function checkDismissalReason(reason: unknown): string | null {
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== "string") return "reason must be a string";
  if (reason.length > MAX_DISMISSAL_REASON_LENGTH) {
    return `reason must be at most ${MAX_DISMISSAL_REASON_LENGTH} characters`;
  }
  return null;
}

function dismissedIds(fileData: DismissibleFileState): string[] {
  return fileData.dismissedTransactionIds ?? [];
}

function dismissedRecords(fileData: DismissibleFileState): DismissedTransactionEntry[] {
  return fileData.dismissedTransactions ?? [];
}

/**
 * True when this file has already rejected this transaction, in either the
 * legacy id array or the record array. Both are read because documents written
 * before the record format exist and still carry only the ids.
 */
export function isTransactionDismissedForFile(
  fileData: DismissibleFileState,
  transactionId: string
): boolean {
  return (
    dismissedIds(fileData).includes(transactionId) ||
    dismissedRecords(fileData).some((d) => d.transactionId === transactionId)
  );
}

/**
 * Rejecting a pair drops the suggestion from the file's queue and blacklists
 * the transaction so re-scoring does not propose it again.
 *
 * Both arrays are rewritten whole rather than appended with arrayUnion: the
 * rejection records differ by `dismissedAt`, so arrayUnion cannot dedupe them
 * and a repeated sweep would stack duplicate records that skew the learning
 * export. The per-array checks here are what make a re-run a no-op — and they
 * are per-array on purpose, so a document written before the record format
 * still gains its record instead of being skipped on the strength of its
 * legacy id alone. The read and the write belong in one Firestore transaction:
 * whole-array writes lose a concurrent rejection otherwise.
 */
export function buildDismissSuggestionUpdates(
  fileData: DismissibleFileState,
  transactionId: string,
  reason?: string | null
): DismissSuggestionOutcome {
  const suggestions = fileData.transactionSuggestions ?? [];
  const dismissed = suggestions.find((s) => s.transactionId === transactionId);

  const ids = dismissedIds(fileData);
  const records = dismissedRecords(fileData);
  const hasId = ids.includes(transactionId);
  const hasRecord = records.some((d) => d.transactionId === transactionId);

  const updates: Record<string, unknown> = {
    transactionSuggestions: suggestions.filter((s) => s.transactionId !== transactionId),
    dismissedTransactionIds: hasId ? ids : [...ids, transactionId],
    dismissedTransactions: hasRecord
      ? records
      : [
          ...records,
          {
            transactionId,
            dismissedAt: Timestamp.now(),
            confidence: dismissed?.confidence ?? null,
            reason: reason ?? null,
          },
        ],
    updatedAt: FieldValue.serverTimestamp(),
  };

  return {
    updates,
    // Reports what this call actually removed. Null means the pair was not on
    // the suggestion list — the normal answer on a sweep re-run, and the reason
    // a re-run is a no-op rather than an error.
    dismissedConfidence: dismissed?.confidence ?? null,
    alreadyDismissed: hasId || hasRecord,
  };
}

/**
 * Undoing a rejection clears the blacklist entries and stops there. It does not
 * put the suggestion back: only `confidence` survived the dismissal, so a
 * restored entry would be missing the match sources that justify it. The pair
 * becomes proposable again the next time transaction matching runs.
 */
export function buildUndismissSuggestionUpdates(
  fileData: DismissibleFileState,
  transactionId: string
): UndismissSuggestionOutcome {
  return {
    updates: {
      dismissedTransactionIds: dismissedIds(fileData).filter((id) => id !== transactionId),
      dismissedTransactions: dismissedRecords(fileData).filter(
        (d) => d.transactionId !== transactionId
      ),
      updatedAt: FieldValue.serverTimestamp(),
    },
    wasDismissed: isTransactionDismissedForFile(fileData, transactionId),
  };
}
