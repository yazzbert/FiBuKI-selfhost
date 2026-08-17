/**
 * Unit tests for the dismissal builders shared by the callable and the MCP tools.
 *
 * These are pure functions over a file document, so no Firestore is involved
 * beyond the FieldValue/Timestamp stand-ins.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => {
  class MockTimestamp {
    constructor(private readonly date: Date) {}
    static fromDate(d: Date) {
      return new MockTimestamp(d);
    }
    static now() {
      return new MockTimestamp(new Date("2026-08-17T12:00:00Z"));
    }
    toDate() {
      return this.date;
    }
    valueOf() {
      return this.date.getTime();
    }
  }

  return {
    FieldValue: {
      serverTimestamp: () => "SERVER_TIMESTAMP",
    },
    Timestamp: MockTimestamp,
  };
});

const {
  MAX_DISMISSAL_REASON_LENGTH,
  buildDismissSuggestionUpdates,
  buildUndismissSuggestionUpdates,
  checkDismissalReason,
  isTransactionDismissedForFile,
} = await import("../dismissSuggestionOps");

const suggestion = (transactionId: string, confidence: number) => ({
  transactionId,
  confidence,
  matchSources: [{ type: "amount", weight: 40 }],
  suggestedAt: new Date("2026-08-01T00:00:00Z"),
});

describe("buildDismissSuggestionUpdates", () => {
  it("removes the suggestion, blacklists the id and records the rejection", () => {
    const outcome = buildDismissSuggestionUpdates(
      {
        transactionSuggestions: [suggestion("tx-1", 82), suggestion("tx-2", 61)],
      },
      "tx-1",
      "coincidental amount"
    );

    expect(outcome.dismissedConfidence).toBe(82);
    expect(outcome.alreadyDismissed).toBe(false);

    expect(outcome.updates.transactionSuggestions).toEqual([suggestion("tx-2", 61)]);
    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-1"]);
    expect(outcome.updates.dismissedTransactions).toEqual([
      expect.objectContaining({
        transactionId: "tx-1",
        confidence: 82,
        reason: "coincidental amount",
      }),
    ]);
    expect(outcome.updates.updatedAt).toBe("SERVER_TIMESTAMP");
  });

  it("stores a null reason when none is given", () => {
    const outcome = buildDismissSuggestionUpdates(
      { transactionSuggestions: [suggestion("tx-1", 70)] },
      "tx-1"
    );

    expect(outcome.updates.dismissedTransactions).toEqual([
      expect.objectContaining({ transactionId: "tx-1", reason: null }),
    ]);
  });

  it("appends to existing dismissals instead of replacing them", () => {
    const existing = {
      transactionId: "tx-0",
      dismissedAt: new Date("2026-07-01T00:00:00Z"),
      confidence: 55,
      reason: null,
    };

    const outcome = buildDismissSuggestionUpdates(
      {
        transactionSuggestions: [suggestion("tx-1", 70)],
        dismissedTransactionIds: ["tx-0"],
        dismissedTransactions: [existing],
      },
      "tx-1"
    );

    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-0", "tx-1"]);
    expect(outcome.updates.dismissedTransactions).toEqual([
      existing,
      expect.objectContaining({ transactionId: "tx-1" }),
    ]);
  });

  it("reports a null confidence for a pair that is not currently suggested", () => {
    const outcome = buildDismissSuggestionUpdates(
      { transactionSuggestions: [suggestion("tx-2", 61)] },
      "tx-1"
    );

    expect(outcome.dismissedConfidence).toBeNull();
    expect(outcome.alreadyDismissed).toBe(false);
    // The pair is still blacklisted — that is what makes the rejection stick.
    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-1"]);
    expect(outcome.updates.transactionSuggestions).toEqual([suggestion("tx-2", 61)]);
  });

  it("is idempotent — a re-run adds no second rejection record", () => {
    const first = buildDismissSuggestionUpdates(
      { transactionSuggestions: [suggestion("tx-1", 82)] },
      "tx-1",
      "coincidence"
    );

    const second = buildDismissSuggestionUpdates(
      {
        transactionSuggestions: first.updates.transactionSuggestions as never[],
        dismissedTransactionIds: first.updates.dismissedTransactionIds as string[],
        dismissedTransactions: first.updates.dismissedTransactions as never[],
      },
      "tx-1",
      "coincidence again"
    );

    expect(second.alreadyDismissed).toBe(true);
    expect(second.dismissedConfidence).toBeNull();
    expect(second.updates.dismissedTransactionIds).toEqual(["tx-1"]);
    // One rejection, one record — a second one would double-count in the
    // learning export that reads this array.
    expect(second.updates.dismissedTransactions).toHaveLength(1);
    expect(second.updates.dismissedTransactions).toEqual([
      expect.objectContaining({ reason: "coincidence" }),
    ]);
  });

  it("backfills a record for a document that carries only the legacy id", () => {
    const outcome = buildDismissSuggestionUpdates(
      { dismissedTransactionIds: ["tx-1"] },
      "tx-1",
      "rejected before the record format existed"
    );

    expect(outcome.alreadyDismissed).toBe(true);
    // The id must not be duplicated...
    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-1"]);
    // ...but the record it never had is exactly what this call can supply.
    expect(outcome.updates.dismissedTransactions).toEqual([
      expect.objectContaining({
        transactionId: "tx-1",
        reason: "rejected before the record format existed",
      }),
    ]);
  });

  it("reports the confidence it removed even when the pair was already blacklisted", () => {
    // Reachable in production: before this change, matching re-proposed a
    // dismissed pair, so a file can hold both the blacklist entry and a live
    // suggestion for the same transaction.
    const outcome = buildDismissSuggestionUpdates(
      {
        transactionSuggestions: [suggestion("tx-1", 82)],
        dismissedTransactionIds: ["tx-1"],
      },
      "tx-1"
    );

    expect(outcome.alreadyDismissed).toBe(true);
    expect(outcome.dismissedConfidence).toBe(82);
    expect(outcome.updates.transactionSuggestions).toEqual([]);
  });

  it("keeps a file with no suggestion arrays at all working", () => {
    const outcome = buildDismissSuggestionUpdates({}, "tx-1");

    expect(outcome.updates.transactionSuggestions).toEqual([]);
    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-1"]);
    expect(outcome.dismissedConfidence).toBeNull();
  });

  it("stores an explicit null reason without blowing up", () => {
    const outcome = buildDismissSuggestionUpdates(
      { transactionSuggestions: [suggestion("tx-1", 70)] },
      "tx-1",
      null
    );

    expect(outcome.updates.dismissedTransactions).toEqual([
      expect.objectContaining({ reason: null }),
    ]);
  });
});

describe("checkDismissalReason", () => {
  it("accepts an absent reason", () => {
    expect(checkDismissalReason(undefined)).toBeNull();
    expect(checkDismissalReason(null)).toBeNull();
  });

  it("accepts a reason at the cap and refuses one past it", () => {
    expect(MAX_DISMISSAL_REASON_LENGTH).toBe(500);
    expect(checkDismissalReason("x".repeat(500))).toBeNull();
    expect(checkDismissalReason("x".repeat(501))).toMatch(/at most 500 characters/);
  });

  it("refuses a non-string reason, which would otherwise skip the cap entirely", () => {
    expect(checkDismissalReason(42)).toMatch(/must be a string/);
    expect(checkDismissalReason({ note: "x".repeat(9999) })).toMatch(/must be a string/);
  });
});

describe("buildUndismissSuggestionUpdates", () => {
  it("clears both the legacy id and the rejection record", () => {
    const outcome = buildUndismissSuggestionUpdates(
      {
        dismissedTransactionIds: ["tx-0", "tx-1"],
        dismissedTransactions: [
          { transactionId: "tx-0", dismissedAt: new Date(), confidence: 55, reason: null },
          { transactionId: "tx-1", dismissedAt: new Date(), confidence: 82, reason: "oops" },
        ],
      },
      "tx-1"
    );

    expect(outcome.wasDismissed).toBe(true);
    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-0"]);
    expect(outcome.updates.dismissedTransactions).toEqual([
      expect.objectContaining({ transactionId: "tx-0" }),
    ]);
    expect(outcome.updates.updatedAt).toBe("SERVER_TIMESTAMP");
  });

  it("does not fabricate a suggestion — re-scoring is what proposes the pair again", () => {
    const outcome = buildUndismissSuggestionUpdates(
      {
        transactionSuggestions: [suggestion("tx-2", 61)],
        dismissedTransactionIds: ["tx-1"],
        dismissedTransactions: [
          { transactionId: "tx-1", dismissedAt: new Date(), confidence: 82, reason: null },
        ],
      },
      "tx-1"
    );

    expect(outcome.updates).not.toHaveProperty("transactionSuggestions");
  });

  it("is idempotent on a pair that was never dismissed", () => {
    const outcome = buildUndismissSuggestionUpdates({ dismissedTransactionIds: ["tx-0"] }, "tx-1");

    expect(outcome.wasDismissed).toBe(false);
    expect(outcome.updates.dismissedTransactionIds).toEqual(["tx-0"]);
    expect(outcome.updates.dismissedTransactions).toEqual([]);
  });
});

describe("isTransactionDismissedForFile", () => {
  it("reads the legacy id array", () => {
    expect(isTransactionDismissedForFile({ dismissedTransactionIds: ["tx-1"] }, "tx-1")).toBe(true);
  });

  it("reads the record array", () => {
    expect(
      isTransactionDismissedForFile(
        {
          dismissedTransactions: [
            { transactionId: "tx-1", dismissedAt: new Date(), confidence: null, reason: null },
          ],
        },
        "tx-1"
      )
    ).toBe(true);
  });

  it("is false for an undismissed pair and for a file with neither array", () => {
    expect(isTransactionDismissedForFile({ dismissedTransactionIds: ["tx-0"] }, "tx-1")).toBe(false);
    expect(isTransactionDismissedForFile({}, "tx-1")).toBe(false);
  });
});
