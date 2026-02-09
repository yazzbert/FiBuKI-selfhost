/**
 * German capital gains tax rules.
 *
 * - Stocks/ETFs: 26.375% Abgeltungssteuer (25% + 5.5% Soli)
 * - Crypto: personal income tax rate (14-45%), but TAX-FREE after 1yr holding
 * - Stock losses can ONLY offset stock gains (separate pool)
 * - Crypto losses offset crypto gains
 * - EUR 1,000 exemption (Sparerpauschbetrag) for stocks/ETFs
 * - Method: FIFO
 */

import { AssetTypeSummary } from "../../types/capital-gains-summary";

/** Abgeltungssteuer rate (25% + 5.5% Soli) */
export const ABGELTUNGSSTEUER_RATE = 0.26375;

/** Annual exemption (Sparerpauschbetrag) in cents */
export const SPARERPAUSCHBETRAG = 100000; // EUR 1,000

export interface GermanyTaxResult {
  /** Stock/ETF gains (separate loss pool) */
  deStockGainsEur: number;
  deStockLossesEur: number;
  /** Crypto gains/losses (separate from stocks) */
  deCryptoGainsEur: number;
  deCryptoLossesEur: number;
  /** Crypto gains exempt due to >1yr holding (already excluded from taxable) */
  deCryptoExemptGainsEur: number;
}

export function calculateGermanyTax(
  summaries: AssetTypeSummary[],
  cryptoExemptGainsEur: number
): GermanyTaxResult {
  let stockGains = 0;
  let stockLosses = 0;
  let cryptoGains = 0;
  let cryptoLosses = 0;

  for (const summary of summaries) {
    if (summary.assetType === "stock" || summary.assetType === "etf" || summary.assetType === "bond") {
      stockGains += summary.realizedGainEur + summary.dividendsEur;
      stockLosses += summary.realizedLossEur;
    } else if (summary.assetType === "crypto") {
      cryptoGains += summary.realizedGainEur + summary.dividendsEur;
      cryptoLosses += summary.realizedLossEur;
    }
  }

  return {
    deStockGainsEur: stockGains,
    deStockLossesEur: stockLosses,
    deCryptoGainsEur: cryptoGains,
    deCryptoLossesEur: cryptoLosses,
    deCryptoExemptGainsEur: cryptoExemptGainsEur,
  };
}
