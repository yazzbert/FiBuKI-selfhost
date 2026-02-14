import { Timestamp } from "firebase-admin/firestore";

/**
 * Card Reconciliation Types (Cloud Functions duplicate)
 *
 * KEEP IN SYNC with types/card-reconciliation.ts
 * Functions rootDir restriction prevents importing from ../../types/
 */

export type ReconciliationPattern =
  | "statement_payment"
  | "pass_through"
  | "partial_payment";

export type ReconciliationGroupStatus = "suggested" | "confirmed" | "rejected";

export interface ReconciliationScoreBreakdown {
  amountSum: number;
  dateWindow: number;
  sourceLink: number;
  partnerSignal: number;
}

export interface CardReconciliationGroup {
  id: string;
  userId: string;
  bankTransactionId: string;
  bankSourceId: string;
  cardSourceId: string;
  cardTransactionIds: string[];
  cardChargesSum: number;
  bankPaymentAmount: number;
  remainderAmount: number;
  pattern: ReconciliationPattern;
  status: ReconciliationGroupStatus;
  confidence: number;
  scoreBreakdown: ReconciliationScoreBreakdown;
  cardChargesDateRange: { from: Timestamp; to: Timestamp };
  rejectedCardTransactionIds?: string[];
  note?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ReconciliationSuggestion {
  groupId: string;
  cardSourceName: string;
  chargeCount: number;
  chargesSum: number;
  confidence: number;
  pattern: ReconciliationPattern;
  remainderAmount: number;
}
