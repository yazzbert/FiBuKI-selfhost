/**
 * Billing cycle — the expected-charge model, computed and never stored.
 *
 * The spec keeps this out of the schema: the next expected window is the last
 * charge date plus the frequency, plus or minus the day variance, and a charge
 * is covered when it carries what the partner is expected to produce. Both are
 * arithmetic over the effective cycle, so they live here as pure functions in
 * plain Dates — the MCP surface, the partner page and the matcher all expect
 * the same window rather than each deriving its own.
 */

import {
  BILLING_CYCLE_CONFIG,
  BillingDocumentExpectation,
  EffectiveBillingCycle,
} from "./billingCycleDerivation";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** When the next charge of a recurrence is due, and how wide the window is. */
export interface ExpectedChargeWindow {
  /** Last charge plus the frequency */
  expectedAt: Date;
  /** expectedAt minus the day variance */
  from: Date;
  /** expectedAt plus the day variance */
  to: Date;
  /** Days the window reaches to either side of expectedAt */
  varianceDays: number;
}

/**
 * Next expected charge after `lastChargeDate`.
 *
 * A declared cycle has no history behind it, so it carries no learned day
 * variance; the interval tolerance the derivation works with is the fallback,
 * which keeps a hand-declared monthly partner from having a zero-width window.
 * Null when there is nothing to expect from (no cycle, no frequency).
 */
export function nextExpectedCharge(
  lastChargeDate: Date | null | undefined,
  cycle: EffectiveBillingCycle | null | undefined
): ExpectedChargeWindow | null {
  if (!lastChargeDate || Number.isNaN(lastChargeDate.getTime())) return null;
  if (!cycle || !(cycle.frequencyDays > 0)) return null;

  const varianceDays = cycle.dayVariance ?? BILLING_CYCLE_CONFIG.INTERVAL_TOLERANCE_DAYS;
  const expectedAt = addDays(lastChargeDate, cycle.frequencyDays);

  return {
    expectedAt,
    from: addDays(expectedAt, -varianceDays),
    to: addDays(expectedAt, varianceDays),
    varianceDays,
  };
}

/** What one charge of a recurrence carries. */
export interface ChargeDocumentState {
  hasFile: boolean;
  hasCategory: boolean;
}

/**
 * Coverage of a set of charges. The three buckets partition `charges`: a charge
 * with a file counts as `withFile` even when it is also categorised.
 */
export interface ChargeCoverage {
  charges: number;
  withFile: number;
  withCategory: number;
  missing: number;
}

/**
 * Count how many charges carry their expected document.
 *
 * The rule is the one `list_transactions_needing_files` already applies — a
 * charge is covered by a connected file or by a no-receipt category — read
 * through the partner's expectation: a partner expected to produce nothing
 * (a bank fee, an N26 reward) can never be missing a document.
 */
export function summarizeCoverage(
  charges: ChargeDocumentState[],
  expectation: BillingDocumentExpectation
): ChargeCoverage {
  const withFile = charges.filter((c) => c.hasFile).length;
  const withCategory = charges.filter((c) => !c.hasFile && c.hasCategory).length;

  return {
    charges: charges.length,
    withFile,
    withCategory,
    missing: expectation === "none" ? 0 : charges.length - withFile - withCategory,
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}
