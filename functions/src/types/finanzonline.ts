/**
 * FinanzOnline WebService types for Cloud Functions
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Encrypted credentials stored server-side only
 * Collection: /finanzonlineCredentials/{userId}
 */
export interface FinanzOnlineCredentialsDocument {
  userId: string;
  teilnehmerId: string;
  benutzerId: string;
  encryptedPin: string;
  iv: string;
  updatedAt: Timestamp;
  createdAt: Timestamp;
}

/**
 * Request to save FinanzOnline credentials
 */
export interface SaveCredentialsRequest {
  teilnehmerId: string;
  benutzerId: string;
  pin: string;
}

/**
 * Response from save credentials
 */
export interface SaveCredentialsResponse {
  success: boolean;
}

/**
 * Response from test connection
 */
export interface TestConnectionResponse {
  success: boolean;
  error?: string;
}

/**
 * UVA report data for submission
 */
export interface UVAReportData {
  taxableRevenue: {
    rate20Net: number;
    rate20Vat: number;
    rate10Net: number;
    rate10Vat: number;
    rate13Net: number;
    rate13Vat: number;
  };
  exemptRevenue: {
    exports: number;
    euDeliveries: number;
    other: number;
  };
  euAcquisitions: {
    netAmount: number;
    vatAmount: number;
  };
  inputVat: {
    standard: number;
    euAcquisitions: number;
    imports: number;
  };
  totalVatPayable: number;
  totalInputVat: number;
  vatBalance: number;
}

/**
 * Report period
 */
export interface ReportPeriod {
  year: number;
  period: number;
  type: "monthly" | "quarterly";
}

/**
 * Request to submit UVA
 */
export interface SubmitUvaRequest {
  report: UVAReportData;
  period: ReportPeriod;
  taxNumber: string;
}

/**
 * Response from UVA submission
 */
export interface SubmitUvaResponse {
  success: boolean;
  referenceNumber?: string;
  submissionId?: string;
  error?: string;
}

/**
 * Submission record for audit trail
 * Collection: /finanzonlineSubmissions/{submissionId}
 */
export interface FinanzOnlineSubmission {
  id: string;
  userId: string;
  periodYear: number;
  periodNumber: number;
  periodType: "monthly" | "quarterly";
  submittedAt: Timestamp;
  referenceNumber?: string;
  status: "pending" | "success" | "failed";
  errorMessage?: string;
  xmlHash: string;
  taxNumber: string;
}
