import { Timestamp } from "firebase-admin/firestore";

/**
 * Type of investment trade/transaction
 * DUPLICATED from types/investment-trade.ts (functions rootDir restriction)
 */
export type TradeType =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "fee"
  | "transfer_in"
  | "transfer_out";

export type AssetType = "stock" | "etf" | "crypto" | "bond" | "other";

export interface FifoLotAssignment {
  buyTradeId: string;
  quantity: number;
  costPerUnitEur: number;
  buyDate: Timestamp;
}

export interface InvestmentTrade {
  id: string;
  userId: string;
  sourceId: string;
  date: Timestamp;
  tradeType: TradeType;
  assetType: AssetType;
  ticker: string;
  isin?: string | null;
  assetName: string;
  quantity: number;
  pricePerUnit: number;
  grossAmount: number;
  fees: number;
  netAmount: number;
  currency: string;
  exchangeRateToEur?: number | null;
  netAmountEur?: number | null;
  _original: {
    date: string;
    quantity: string;
    pricePerUnit: string;
    grossAmount: string;
    fees: string;
    rawRow: Record<string, string>;
  };
  dedupeHash: string;
  importJobId: string | null;
  csvRowIndex?: number;
  realizedGainEur?: number | null;
  costBasisEur?: number | null;
  isAltbestand?: boolean | null;
  isHoldingPeriodExempt?: boolean | null;
  fifoLotAssignments?: FifoLotAssignment[];
  fifoCalculated?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
