/**
 * Austrian capital gains tax rules.
 *
 * - 27.5% KESt (Kapitalertragsteuer) on all investment gains
 * - Same rate for stocks, ETFs, and crypto
 * - Altbestand: crypto acquired before 2021-03-01 is tax-free
 * - Loss offset: same year only, no carryforward
 * - Method: FIFO
 */

import { AssetTypeSummary } from "../../types/capital-gains-summary";

const KEST_RATE = 0.275;

export interface AustriaTaxResult {
  /** Total KESt liability in EUR cents */
  kestLiabilityEur: number;
}

/**
 * Calculate Austrian KESt liability.
 * Losses offset gains within the same year (no carryforward).
 */
export function calculateAustriaTax(
  summaries: AssetTypeSummary[]
): AustriaTaxResult {
  // Sum up all net gains across asset types
  // In Austria, losses from one asset type CAN offset gains from another
  let totalNetGain = 0;

  for (const summary of summaries) {
    totalNetGain += summary.netGainEur;
    totalNetGain += summary.dividendsEur;
  }

  // KESt only applies to positive net gains (no negative tax)
  const taxableGain = Math.max(0, totalNetGain);
  const kestLiabilityEur = Math.round(taxableGain * KEST_RATE);

  return { kestLiabilityEur };
}
