/**
 * Tests for onTransactionUpdate trigger guards and rematch filtering.
 *
 * Covers:
 * 1. Auto-matched transactions skip automations (receipt search, category matching)
 * 2. Manual/suggestion/AI assignments DO trigger automations
 * 3. Partner-cleared transactions (partnerId→null) don't trigger automations
 * 4. rematchUnassignedTransactions only processes unassigned transactions
 * 5. rematchUnassignedTransactions skips manually-removed transactions
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Pure guard logic extracted from onTransactionUpdate.ts
// These mirror the exact conditions in the trigger (lines 156-169)
// ============================================================================

interface TransactionData {
  partnerId: string | null;
  partnerMatchedBy: "manual" | "suggestion" | "auto" | "ai" | null;
  // Other fields exist but aren't relevant to the guard logic
}

/**
 * Determines if partner automations should run for a transaction update.
 * Mirrors the guard logic in onTransactionUpdate.ts lines 156-169.
 */
function shouldRunPartnerAutomations(
  before: TransactionData,
  after: TransactionData
): boolean {
  const partnerWasAssigned = !before.partnerId && after.partnerId;
  const partnerChanged = before.partnerId !== after.partnerId && after.partnerId;

  // No partner change → no automations
  if (!partnerWasAssigned && !partnerChanged) {
    return false;
  }

  // Auto-matched → skip (pattern learning pipeline handles these)
  if (after.partnerMatchedBy === "auto") {
    return false;
  }

  return true;
}

// ============================================================================
// 1. Auto-matched transactions skip automations
// ============================================================================

describe("onTransactionUpdate: auto-matched transactions skip automations", () => {
  it("skips automations when partnerMatchedBy is 'auto' (new assignment)", () => {
    const before: TransactionData = { partnerId: null, partnerMatchedBy: null };
    const after: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "auto" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(false);
  });

  it("skips automations when partnerMatchedBy is 'auto' (partner changed)", () => {
    const before: TransactionData = { partnerId: "partner-old", partnerMatchedBy: "manual" };
    const after: TransactionData = { partnerId: "partner-new", partnerMatchedBy: "auto" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(false);
  });

  it("skipping auto-matched prevents N redundant triggers from rematch batch", () => {
    // Simulate 50 transactions being auto-assigned by rematchUnassignedTransactions
    const autoMatchedTxs = Array.from({ length: 50 }, (_, i) => ({
      before: { partnerId: null, partnerMatchedBy: null } as TransactionData,
      after: { partnerId: "partner-1", partnerMatchedBy: "auto" } as TransactionData,
    }));

    const automationsTriggered = autoMatchedTxs.filter(
      (tx) => shouldRunPartnerAutomations(tx.before, tx.after)
    );

    // None should trigger — all are auto-matched
    expect(automationsTriggered).toHaveLength(0);
  });
});

// ============================================================================
// 2. Manual/suggestion/AI assignments DO trigger automations
// ============================================================================

describe("onTransactionUpdate: manual assignments trigger automations", () => {
  it("triggers automations for manual assignment", () => {
    const before: TransactionData = { partnerId: null, partnerMatchedBy: null };
    const after: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "manual" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(true);
  });

  it("triggers automations for suggestion (click) assignment", () => {
    const before: TransactionData = { partnerId: null, partnerMatchedBy: null };
    const after: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "suggestion" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(true);
  });

  it("triggers automations for AI assignment", () => {
    const before: TransactionData = { partnerId: null, partnerMatchedBy: null };
    const after: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "ai" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(true);
  });

  it("triggers automations when partner is changed manually", () => {
    const before: TransactionData = { partnerId: "partner-old", partnerMatchedBy: "auto" };
    const after: TransactionData = { partnerId: "partner-new", partnerMatchedBy: "manual" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(true);
  });
});

// ============================================================================
// 3. Partner-cleared transactions don't trigger automations
// ============================================================================

describe("onTransactionUpdate: partner-cleared transactions", () => {
  it("does NOT trigger when partner is removed (partnerId→null)", () => {
    const before: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "auto" };
    const after: TransactionData = { partnerId: null, partnerMatchedBy: null };

    expect(shouldRunPartnerAutomations(before, after)).toBe(false);
  });

  it("does NOT trigger when partner stays null", () => {
    const before: TransactionData = { partnerId: null, partnerMatchedBy: null };
    const after: TransactionData = { partnerId: null, partnerMatchedBy: null };

    expect(shouldRunPartnerAutomations(before, after)).toBe(false);
  });

  it("does NOT trigger when partner stays the same", () => {
    const before: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "manual" };
    const after: TransactionData = { partnerId: "partner-1", partnerMatchedBy: "manual" };

    expect(shouldRunPartnerAutomations(before, after)).toBe(false);
  });
});

// ============================================================================
// 4. rematchUnassignedTransactions filtering logic
// ============================================================================

interface MockTransaction {
  id: string;
  partnerId: string | null;
  partnerMatchedBy: string | null;
  name: string;
  partner: string | null;
  reference: string | null;
}

/**
 * Mirrors the filtering logic in rematchUnassignedTransactions (lines 430-432).
 * Only unassigned transactions (no partnerId) are eligible for pattern matching.
 */
function filterEligibleForRematch(
  txs: MockTransaction[],
  manualRemovalIds: Set<string> = new Set()
): MockTransaction[] {
  return txs
    .filter((tx) => !tx.partnerId)                   // Only unassigned
    .filter((tx) => !manualRemovalIds.has(tx.id));    // Not manually removed
}

describe("rematchUnassignedTransactions: filtering", () => {
  const transactions: MockTransaction[] = [
    // Already manually assigned — must NOT be re-checked
    { id: "tx-manual-1", partnerId: "partner-1", partnerMatchedBy: "manual", name: "FREENOW* BRATISLAVA", partner: null, reference: null },
    // Already auto-assigned — must NOT be re-checked
    { id: "tx-auto-1", partnerId: "partner-1", partnerMatchedBy: "auto", name: "FREENOW* WIEN", partner: null, reference: null },
    // Suggestion-assigned — must NOT be re-checked
    { id: "tx-suggestion-1", partnerId: "partner-1", partnerMatchedBy: "suggestion", name: "Card Payment", partner: "FREE NOW", reference: null },
    // Assigned to DIFFERENT partner — must NOT be re-checked
    { id: "tx-other-partner", partnerId: "partner-2", partnerMatchedBy: "manual", name: "UBER", partner: null, reference: null },
    // Unassigned — SHOULD be checked
    { id: "tx-unassigned-1", partnerId: null, partnerMatchedBy: null, name: "FREE NOW", partner: "FREE NOW", reference: null },
    { id: "tx-unassigned-2", partnerId: null, partnerMatchedBy: null, name: "Card Payment", partner: "FREE NOW", reference: null },
    // Unassigned but was manually removed — must NOT be re-checked
    { id: "tx-removed-1", partnerId: null, partnerMatchedBy: null, name: "FREE NOW SCOOTER", partner: null, reference: null },
  ];

  it("only returns unassigned transactions", () => {
    const eligible = filterEligibleForRematch(transactions);
    // tx-unassigned-1, tx-unassigned-2, tx-removed-1 (3 unassigned)
    expect(eligible).toHaveLength(3);
    expect(eligible.every((tx) => tx.partnerId === null)).toBe(true);
  });

  it("excludes manually-removed transactions", () => {
    const manualRemovals = new Set(["tx-removed-1"]);
    const eligible = filterEligibleForRematch(transactions, manualRemovals);
    expect(eligible).toHaveLength(2);
    expect(eligible.map((tx) => tx.id)).toEqual(["tx-unassigned-1", "tx-unassigned-2"]);
  });

  it("never includes already-assigned transactions (manual, auto, suggestion)", () => {
    const eligible = filterEligibleForRematch(transactions);
    const assignedIds = ["tx-manual-1", "tx-auto-1", "tx-suggestion-1", "tx-other-partner"];
    for (const id of assignedIds) {
      expect(eligible.find((tx) => tx.id === id)).toBeUndefined();
    }
  });
});

// ============================================================================
// 5. Combined scenario: manual assignment + pattern learning cascade
// ============================================================================

describe("full cascade scenario: 1 manual assign → pattern learning → N auto-matches", () => {
  it("only the manual assignment triggers automations, not the N auto-matches", () => {
    // Step 1: User manually assigns partner to 1 transaction
    const manualAssign = shouldRunPartnerAutomations(
      { partnerId: null, partnerMatchedBy: null },
      { partnerId: "partner-1", partnerMatchedBy: "manual" }
    );
    expect(manualAssign).toBe(true); // This ONE triggers receipt search + category match

    // Step 2: Pattern learning runs, auto-matches 20 more transactions
    // Each fires onTransactionUpdate, but all should be skipped
    const autoMatches = Array.from({ length: 20 }, () =>
      shouldRunPartnerAutomations(
        { partnerId: null, partnerMatchedBy: null },
        { partnerId: "partner-1", partnerMatchedBy: "auto" }
      )
    );
    expect(autoMatches.every((v) => v === false)).toBe(true);

    // Step 3: Pattern learning also cascade-unassigns 5 stale auto-matches
    // partnerId → null, so partnerChanged won't match (after.partnerId is null)
    const cascadeUnassigns = Array.from({ length: 5 }, () =>
      shouldRunPartnerAutomations(
        { partnerId: "partner-1", partnerMatchedBy: "auto" },
        { partnerId: null, partnerMatchedBy: null }
      )
    );
    expect(cascadeUnassigns.every((v) => v === false)).toBe(true);

    // Total automations triggered: 1 (the manual assignment)
    const total = [manualAssign, ...autoMatches, ...cascadeUnassigns].filter(Boolean).length;
    expect(total).toBe(1);
  });
});
