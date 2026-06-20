/**
 * Tests for computeInvoiceTotals.
 * Inputs are in cents; VAT rate is percent.
 */

import { describe, it, expect } from "vitest";
import { computeInvoiceTotals, computeLineItemTotals } from "../types";

describe("computeLineItemTotals", () => {
  it("handles 20% VAT cleanly", () => {
    const result = computeLineItemTotals({
      id: "1",
      description: "x",
      quantity: 1,
      unitPrice: 10000, // 100.00
      vatRate: 20,
    });
    expect(result.netCents).toBe(10000);
    expect(result.vatCents).toBe(2000);
    expect(result.grossCents).toBe(12000);
  });

  it("rounds half-cent VAT correctly", () => {
    // 333 cents * 20% = 66.6 -> round to 67
    const result = computeLineItemTotals({
      id: "2",
      description: "y",
      quantity: 1,
      unitPrice: 333,
      vatRate: 20,
    });
    expect(result.netCents).toBe(333);
    expect(result.vatCents).toBe(67);
    expect(result.grossCents).toBe(400);
  });

  it("supports 0% VAT", () => {
    const result = computeLineItemTotals({
      id: "3",
      description: "z",
      quantity: 2,
      unitPrice: 5000,
      vatRate: 0,
    });
    expect(result.netCents).toBe(10000);
    expect(result.vatCents).toBe(0);
    expect(result.grossCents).toBe(10000);
  });

  it("supports fractional quantities", () => {
    // 1.5 * 10000 = 15000
    const result = computeLineItemTotals({
      id: "4",
      description: "w",
      quantity: 1.5,
      unitPrice: 10000,
      vatRate: 10,
    });
    expect(result.netCents).toBe(15000);
    expect(result.vatCents).toBe(1500);
    expect(result.grossCents).toBe(16500);
  });
});

describe("computeInvoiceTotals", () => {
  it("returns zero for empty line items", () => {
    const r = computeInvoiceTotals([]);
    expect(r).toEqual({ subtotal: 0, vatAmount: 0, total: 0 });
  });

  it("sums multiple items with mixed VAT", () => {
    const r = computeInvoiceTotals([
      { id: "1", description: "a", quantity: 1, unitPrice: 10000, vatRate: 20 },
      { id: "2", description: "b", quantity: 2, unitPrice: 5000, vatRate: 10 },
    ]);
    // Net: 10000 + 10000 = 20000
    // VAT: 2000 + 1000 = 3000
    expect(r.subtotal).toBe(20000);
    expect(r.vatAmount).toBe(3000);
    expect(r.total).toBe(23000);
  });

  it("aggregates rounded line VAT (not rounded sum)", () => {
    // Two items each producing fractional VAT
    const r = computeInvoiceTotals([
      { id: "1", description: "a", quantity: 1, unitPrice: 333, vatRate: 20 },
      { id: "2", description: "b", quantity: 1, unitPrice: 333, vatRate: 20 },
    ]);
    // Per-line VAT rounds 66.6 -> 67, sum = 134
    expect(r.subtotal).toBe(666);
    expect(r.vatAmount).toBe(134);
    expect(r.total).toBe(800);
  });
});
