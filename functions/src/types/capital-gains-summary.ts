import { Timestamp } from "firebase-admin/firestore";
import { AssetType } from "./investment-trade";

/**
 * DUPLICATED from types/capital-gains-summary.ts (functions rootDir restriction)
 */

export type TaxCountryCode = "AT" | "DE" | "CH";

export interface AssetTypeSummary {
  assetType: AssetType;
  realizedGainEur: number;
  realizedLossEur: number;
  netGainEur: number;
  dividendsEur: number;
  feesEur: number;
  tradeCount: number;
}

export interface YearEndHolding {
  ticker: string;
  assetName: string;
  assetType: AssetType;
  quantity: number;
  marketValueEur: number;
}

export interface CapitalGainsSummary {
  id: string;
  userId: string;
  year: number;
  country: TaxCountryCode;
  byAssetType: AssetTypeSummary[];
  totalRealizedGainEur: number;
  totalRealizedLossEur: number;
  totalNetGainEur: number;
  totalDividendsEur: number;
  totalFeesEur: number;
  kestLiabilityEur?: number;
  deStockGainsEur?: number;
  deStockLossesEur?: number;
  deCryptoGainsEur?: number;
  deCryptoLossesEur?: number;
  deCryptoExemptGainsEur?: number;
  chYearEndHoldings?: YearEndHolding[];
  tradeCount: number;
  calculatedAt: Timestamp;
}
