/**
 * Reading the dismissal list a file carries (fork #94).
 *
 * dismissTransactionSuggestion writes two shapes of the same fact: the legacy
 * `dismissedTransactionIds` string array and the richer `dismissedTransactions`
 * records (dismissedAt, confidence, and — once the MCP tool lands — reason).
 * Every path that proposes or auto-connects a file-to-transaction pair reads
 * both through here, so a rejection recorded by the UI and one recorded by an
 * agent enforce identically.
 */

/** The two fields a file document uses to record dismissed pairs. */
export interface FileDismissalFields {
  dismissedTransactionIds?: unknown;
  dismissedTransactions?: unknown;
}

/**
 * Transaction ids this file has had dismissed, from either stored shape.
 *
 * Takes `unknown` on purpose: callers hand it a raw DocumentData, a typed
 * TaxFile, or a projection, and neither of the two fields is declared on most
 * of those types. Every value read is shape-checked below.
 */
export function readDismissedTransactionIds(fileData: unknown): Set<string> {
  const ids = new Set<string>();
  const source = (fileData ?? {}) as FileDismissalFields;

  const legacy = source.dismissedTransactionIds;
  if (Array.isArray(legacy)) {
    for (const id of legacy) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }

  const records = source.dismissedTransactions;
  if (Array.isArray(records)) {
    for (const record of records) {
      const id = (record as { transactionId?: unknown } | null)?.transactionId;
      if (typeof id === "string" && id) ids.add(id);
    }
  }

  return ids;
}

/**
 * Single-pair check, for callers scoring one file against one transaction.
 * Callers looping over many transactions for the same file should hoist
 * readDismissedTransactionIds out of the loop instead.
 */
export function isTransactionDismissed(
  fileData: unknown,
  transactionId: string
): boolean {
  return readDismissedTransactionIds(fileData).has(transactionId);
}
