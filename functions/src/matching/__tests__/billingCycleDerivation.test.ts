/**
 * Tests for the pure billing-cycle derivation.
 *
 * Fixture histories in, learned structure out — nothing here touches Firestore.
 * The callable's end-to-end behaviour stays pinned by the self-host
 * characterization suite (src/selfhost/matching-characterization.test.ts).
 *
 * Covers:
 * - deriveBillingCycle over fixture partner histories (band split included)
 * - resolveEffectiveCycle: declared over learned, field by field
 * - mergeBillingCycle: a declared cycle survives a re-learn
 * - normalizeBillingCycle / toStoredBillingCycle: the pre-split shape round-trips
 */

import { describe, it, expect } from "vitest";
import {
  BillingCycleTransaction,
  DeclaredBillingCycle,
  LearnedBillingCycle,
  bandKeyOf,
  cadenceToFrequencyDays,
  deriveBillingCycle,
  mergeBillingCycle,
  normalizeBillingCycle,
  resolveEffectiveCycle,
  splitByAmountBand,
  toStoredBillingCycle,
} from "../billingCycleDerivation";

const NOW = new Date("2026-08-21T00:00:00Z");

/** Build a partner history: one transaction per (date, amount) pair. */
function history(
  rows: Array<[date: string, amount: number]>,
  currency = "EUR"
): BillingCycleTransaction[] {
  return rows.map(([date, amount], i) => ({
    id: `tx-${i}`,
    date: new Date(`${date}T12:00:00Z`),
    amount,
    currency,
  }));
}

/** Monthly on the same day-of-month, `count` charges of `amount`. */
function monthly(
  count: number,
  amount: number,
  day = 15,
  startMonth = 1
): Array<[string, number]> {
  return Array.from({ length: count }, (_, i) => {
    const month = String(startMonth + i).padStart(2, "0");
    return [`2026-${month}-${String(day).padStart(2, "0")}`, amount] as [string, number];
  });
}

// ============================================================================
// deriveBillingCycle — fixture partner histories
// ============================================================================

describe("deriveBillingCycle", () => {
  it("learns a clean monthly partner as one recurrence", () => {
    // Jan–Jun on the 15th → intervals [31,28,31,30,31]
    const derived = deriveBillingCycle({
      transactions: history(monthly(6, -49.9)),
      now: NOW,
    });

    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      frequencyDays: 30,
      // consistency 5/5 → 80; avg deviation (1+2+1+0+1)/5 = 1 → +18
      frequencyConfidence: 98,
      typicalDayOfMonth: 15,
      dayVariance: 0,
      sampleSize: 6,
      amountBand: { min: 49.9, max: 49.9, currency: "EUR" },
    });
    expect(derived[0].learnedAt).toEqual(NOW);
    // No connected invoices → the delay fields stay unlearned and absent.
    expect("invoiceToTransactionDelay" in derived[0]).toBe(false);
  });

  it("learns the invoice-to-transaction delay from connected invoice dates", () => {
    const transactions = history(monthly(6, -49.9));
    const derived = deriveBillingCycle({
      transactions,
      // Three invoices, each extracted 5 days before its charge — the minimum
      // sample for the delay fields to be learned.
      connectedInvoiceDates: [0, 1, 2].map((i) => ({
        transactionId: transactions[i].id,
        invoiceDate: new Date(`2026-0${i + 1}-10T12:00:00Z`),
      })),
      now: NOW,
    });

    expect(derived[0]).toMatchObject({
      invoiceToTransactionDelay: 5,
      delayVariance: 0,
    });
  });

  it("keeps a USD partner whose EUR amount drifts as one recurrence", () => {
    // 20.00 USD billed monthly; the booked EUR amount moves with the rate.
    const derived = deriveBillingCycle({
      transactions: history([
        ["2026-01-08", -18.4],
        ["2026-02-08", -18.72],
        ["2026-03-08", -19.05],
        ["2026-04-08", -18.31],
        ["2026-05-08", -18.66],
        ["2026-06-08", -19.2],
      ]),
      now: NOW,
    });

    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      frequencyDays: 30,
      sampleSize: 6,
      typicalDayOfMonth: 8,
      amountBand: { min: 18.31, max: 19.2, currency: "EUR" },
    });
  });

  it("splits an Anthropic-shaped history into a weekly and a monthly band", () => {
    const derived = deriveBillingCycle({
      transactions: history([
        // weekly API usage
        ["2026-06-01", -38.25],
        ["2026-06-08", -38.25],
        ["2026-06-15", -38.25],
        ["2026-06-22", -38.25],
        ["2026-06-29", -38.25],
        ["2026-07-06", -38.25],
        // monthly subscription
        ["2026-04-05", -90],
        ["2026-05-05", -90],
        ["2026-06-05", -90],
        ["2026-07-05", -90],
      ]),
      now: NOW,
    });

    expect(derived).toHaveLength(2);
    // Primary is the band with the most history: the weekly one.
    expect(derived[0]).toMatchObject({
      frequencyDays: 7,
      frequencyConfidence: 100,
      sampleSize: 6,
      amountBand: { min: 38.25, max: 38.25, currency: "EUR" },
    });
    expect(derived[1]).toMatchObject({
      frequencyDays: 30,
      sampleSize: 4,
      amountBand: { min: 90, max: 90, currency: "EUR" },
    });
  });

  it("yields nothing for too few rows", () => {
    expect(
      deriveBillingCycle({
        transactions: history([
          ["2026-01-15", -49.9],
          ["2026-02-15", -49.9],
        ]),
        now: NOW,
      })
    ).toEqual([]);
  });

  it("yields nothing for an irregular partner", () => {
    // intervals [14,64,12,100,57] — no interval repeats 3 times
    const derived = deriveBillingCycle({
      transactions: history([
        ["2026-01-01", -80],
        ["2026-01-15", -80],
        ["2026-03-20", -80],
        ["2026-04-01", -80],
        ["2026-07-10", -80],
        ["2026-09-05", -80],
      ]),
      now: NOW,
    });

    expect(derived).toEqual([]);
  });

  it("falls back to the whole history when no band is thick enough", () => {
    // Utility-style amounts that never settle: every band would hold one row,
    // so the split is dropped and the pre-split behaviour applies.
    const derived = deriveBillingCycle({
      transactions: history([
        ["2026-01-15", -80],
        ["2026-02-15", -95],
        ["2026-03-15", -112],
        ["2026-04-15", -134],
        ["2026-05-15", -158],
      ]),
      now: NOW,
    });

    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({ frequencyDays: 30, sampleSize: 5 });
  });

  it("ignores a band too thin to be a recurrence of its own", () => {
    const derived = deriveBillingCycle({
      transactions: history([
        ...monthly(5, -49.9),
        // two one-off charges, far from the subscription band
        ["2026-02-02", -410],
        ["2026-03-03", -415],
      ]),
      now: NOW,
    });

    expect(derived).toHaveLength(1);
    expect(derived[0].sampleSize).toBe(5);
  });
});

// ============================================================================
// splitByAmountBand
// ============================================================================

describe("splitByAmountBand", () => {
  it("keeps the whole history as one band when an amount is missing", () => {
    const txs = history(monthly(3, -49.9));
    delete txs[1].amount;
    expect(splitByAmountBand(txs)).toHaveLength(1);
  });

  it("returns each band in date order", () => {
    const bands = splitByAmountBand(
      history([
        ["2026-03-01", -38.25],
        ["2026-01-01", -38.25],
        ["2026-02-01", -38.25],
      ])
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].map((tx) => tx.date.getUTCMonth())).toEqual([0, 1, 2]);
  });

  it("does not chain a ladder of small steps into one band", () => {
    // Each step is inside the tolerance of its neighbour but not of the anchor.
    const bands = splitByAmountBand(
      history([
        ["2026-01-01", -10],
        ["2026-02-01", -11],
        ["2026-03-01", -12.5],
        ["2026-04-01", -14],
      ])
    );
    expect(bands.length).toBeGreaterThan(1);
  });
});

// ============================================================================
// resolveEffectiveCycle
// ============================================================================

describe("resolveEffectiveCycle", () => {
  const learned: LearnedBillingCycle = {
    frequencyDays: 30,
    frequencyConfidence: 98,
    typicalDayOfMonth: 15,
    dayVariance: 1,
    invoiceToTransactionDelay: 5,
    delayVariance: 2,
    sampleSize: 6,
    learnedAt: NOW,
    amountBand: { min: 49.9, max: 49.9, currency: "EUR" },
  };

  it("reads the learned half when nothing is declared", () => {
    expect(resolveEffectiveCycle(learned)).toMatchObject({
      source: "learned",
      frequencyDays: 30,
      frequencyConfidence: 98,
      invoiceToTransactionDelay: 5,
      // A partner that bills is expected to invoice unless declared otherwise.
      documentExpectation: "invoice",
    });
  });

  it("lets the declared half win field by field, keeping what only the history knows", () => {
    const declared: DeclaredBillingCycle = {
      cadence: "quarterly",
      frequencyDays: 90,
      typicalDayOfMonth: 1,
      documentExpectation: "no_receipt_category",
    };

    expect(resolveEffectiveCycle(learned, declared)).toMatchObject({
      source: "declared",
      frequencyDays: 90,
      typicalDayOfMonth: 1,
      documentExpectation: "no_receipt_category",
      // Variance and delay are not things a user states — still learned.
      dayVariance: 1,
      invoiceToTransactionDelay: 5,
      delayVariance: 2,
    });
  });

  it("resolves a declared cycle with no history behind it", () => {
    expect(
      resolveEffectiveCycle(undefined, {
        cadence: "monthly",
        frequencyDays: 30,
        expectedAmount: { min: 9, max: 11, currency: "USD" },
        documentExpectation: "invoice",
      })
    ).toMatchObject({
      source: "declared",
      frequencyDays: 30,
      amountBand: { min: 9, max: 11, currency: "USD" },
    });
  });

  it("returns nothing when neither half carries a frequency", () => {
    expect(resolveEffectiveCycle()).toBeUndefined();
    expect(
      resolveEffectiveCycle(undefined, {
        cadence: "custom",
        frequencyDays: 0,
        documentExpectation: "none",
      })
    ).toBeUndefined();
  });

  it("maps named cadences to days and leaves custom alone", () => {
    expect(cadenceToFrequencyDays("weekly")).toBe(7);
    expect(cadenceToFrequencyDays("monthly")).toBe(30);
    expect(cadenceToFrequencyDays("quarterly")).toBe(90);
    expect(cadenceToFrequencyDays("yearly")).toBe(365);
    expect(cadenceToFrequencyDays("custom", 45)).toBe(45);
  });
});

// ============================================================================
// mergeBillingCycle — a declared cycle survives a re-learn
// ============================================================================

describe("mergeBillingCycle", () => {
  const declared: DeclaredBillingCycle = {
    cadence: "monthly",
    frequencyDays: 30,
    expectedAmount: { min: 85, max: 95, currency: "EUR" },
    documentExpectation: "invoice",
  };

  function anthropicShaped() {
    return deriveBillingCycle({
      transactions: history([
        ["2026-06-01", -38.25],
        ["2026-06-08", -38.25],
        ["2026-06-15", -38.25],
        ["2026-06-22", -38.25],
        ["2026-06-29", -38.25],
        ["2026-07-06", -38.25],
        ["2026-04-05", -90],
        ["2026-05-05", -90],
        ["2026-06-05", -90],
        ["2026-07-05", -90],
      ]),
      now: NOW,
    });
  }

  it("carries the declared half onto the recurrence whose band it covers", () => {
    const existing = mergeBillingCycle(null, anthropicShaped())!;
    // The user declares the monthly subscription by hand.
    existing.recurrences[1].declared = declared;

    const relearned = mergeBillingCycle(existing, anthropicShaped())!;

    expect(relearned.recurrences).toHaveLength(2);
    expect(relearned.recurrences[0].declared).toBeUndefined();
    expect(relearned.recurrences[1].declared).toEqual(declared);
    expect(relearned.recurrences[1].effective).toMatchObject({ source: "declared" });
    // The learned half is still there beside it, so drift stays visible.
    expect(relearned.recurrences[1].learned).toMatchObject({ frequencyDays: 30 });
  });

  it("keeps a declared band that no longer shows any history", () => {
    const existing = mergeBillingCycle(null, deriveBillingCycle({
      transactions: history(monthly(6, -49.9)),
      now: NOW,
    }))!;
    existing.recurrences[0].declared = {
      cadence: "yearly",
      frequencyDays: 365,
      expectedAmount: { min: 200, max: 220, currency: "EUR" },
      documentExpectation: "invoice",
    };

    const relearned = mergeBillingCycle(existing, deriveBillingCycle({
      transactions: history(monthly(6, -49.9)),
      now: NOW,
    }))!;

    expect(relearned.recurrences).toHaveLength(2);
    const declaredOnly = relearned.recurrences.find((r) => !r.learned)!;
    expect(declaredOnly.declared!.cadence).toBe("yearly");
    expect(declaredOnly.effective).toMatchObject({ source: "declared", frequencyDays: 365 });
  });

  it("exposes the primary recurrence's halves on the structure", () => {
    const merged = mergeBillingCycle(null, anthropicShaped())!;
    expect(merged.learned).toBe(merged.recurrences[0].learned);
    expect(merged.effective).toBe(merged.recurrences[0].effective);
  });

  it("returns null when there is nothing to remember", () => {
    expect(mergeBillingCycle(null, [])).toBeNull();
  });
});

// ============================================================================
// Stored shape
// ============================================================================

describe("normalizeBillingCycle", () => {
  it("reads the pre-split single-cycle shape as the one-band case", () => {
    const structure = normalizeBillingCycle({
      frequencyDays: 30,
      frequencyConfidence: 98,
      typicalDayOfMonth: 15,
      dayVariance: 0,
      invoiceToTransactionDelay: 5,
      delayVariance: 1,
      sampleSize: 6,
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    })!;

    expect(structure.recurrences).toHaveLength(1);
    expect(structure.learned).toMatchObject({ frequencyDays: 30, sampleSize: 6 });
    expect(structure.learned!.learnedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
    expect(structure.effective).toMatchObject({ source: "learned", frequencyDays: 30 });
    expect(structure.recurrences[0].bandKey).toBe("default");
  });

  it("reads Firestore Timestamps as well as Dates", () => {
    const structure = normalizeBillingCycle({
      recurrences: [
        {
          learned: {
            frequencyDays: 7,
            frequencyConfidence: 100,
            sampleSize: 6,
            learnedAt: { toDate: () => new Date("2026-07-01T00:00:00Z") },
            amountBand: { min: 38.25, max: 38.25, currency: "EUR" },
          },
        },
      ],
    })!;

    expect(structure.recurrences[0].bandKey).toBe("EUR:38-38");
    expect(structure.learned!.learnedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
  });

  it("returns null for a partner with no cycle", () => {
    expect(normalizeBillingCycle(undefined)).toBeNull();
    expect(normalizeBillingCycle({})).toBeNull();
  });

  it("bandKeyOf falls back to \"default\" without a band", () => {
    expect(bandKeyOf()).toBe("default");
    expect(bandKeyOf({ min: 38.25, max: 39.4, currency: "EUR" })).toBe("EUR:38-39");
  });
});

describe("toStoredBillingCycle", () => {
  const toTimestamp = (d: Date) => ({ __ts: d.toISOString() });

  it("mirrors the primary recurrence flat, so pre-split readers keep working", () => {
    const merged = mergeBillingCycle(
      null,
      deriveBillingCycle({ transactions: history(monthly(6, -49.9)), now: NOW })
    )!;

    const stored = toStoredBillingCycle(merged, toTimestamp, NOW);

    expect(stored).toMatchObject({
      frequencyDays: 30,
      frequencyConfidence: 98,
      typicalDayOfMonth: 15,
      dayVariance: 0,
      sampleSize: 6,
    });
    expect(stored.updatedAt).toEqual(toTimestamp(NOW));
    expect(stored.learned).toBeDefined();
    expect(stored.effective).toBeDefined();
    expect(stored.recurrences).toHaveLength(1);
    // Unlearned delay fields are ABSENT, not written as undefined —
    // firebase-admin rejects those and ignoreUndefinedProperties is never on.
    expect("invoiceToTransactionDelay" in stored).toBe(false);
    expect("delayVariance" in stored).toBe(false);
  });

  it("round-trips through normalizeBillingCycle", () => {
    const merged = mergeBillingCycle(
      null,
      deriveBillingCycle({ transactions: history(monthly(6, -49.9)), now: NOW })
    )!;
    merged.recurrences[0].declared = {
      cadence: "monthly",
      frequencyDays: 30,
      documentExpectation: "no_receipt_category",
      declaredAt: NOW,
    };

    const stored = toStoredBillingCycle(
      mergeBillingCycle(merged, deriveBillingCycle({
        transactions: history(monthly(6, -49.9)),
        now: NOW,
      }))!,
      (d) => d,
      NOW
    );

    const back = normalizeBillingCycle(stored)!;
    expect(back.declared).toMatchObject({
      cadence: "monthly",
      documentExpectation: "no_receipt_category",
    });
    expect(back.learned).toMatchObject({ frequencyDays: 30, sampleSize: 6 });
    expect(back.effective).toMatchObject({ source: "declared", frequencyDays: 30 });
  });

  it("calls a declaration with no history certain", () => {
    const structure = mergeBillingCycle(
      { recurrences: [{ bandKey: "default", declared: {
        cadence: "monthly",
        frequencyDays: 30,
        documentExpectation: "invoice",
      } }] },
      []
    )!;

    const stored = toStoredBillingCycle(structure, toTimestamp, NOW);
    expect(stored.frequencyDays).toBe(30);
    expect(stored.frequencyConfidence).toBe(100);
    expect(stored.sampleSize).toBe(0);
  });
});
