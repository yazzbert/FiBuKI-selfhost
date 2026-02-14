import { Timestamp } from "firebase-admin/firestore";

/**
 * Status of a BMD export job
 */
export type BmdExportStatus = "pending" | "processing" | "completed" | "failed";

/**
 * BMD export processing phases
 */
export type BmdExportPhase =
  | "collecting"
  | "generating"
  | "packaging"
  | "uploading"
  | "complete";

/**
 * Request to initiate a BMD NTCS export
 */
export interface BmdExportRequest {
  dateFrom: string; // ISO date string
  dateTo: string; // ISO date string
  /** Only export complete transactions (with receipts OR no-receipt category). Field name kept for backward compat. */
  onlyWithFiles: boolean;
  includeFiles: boolean;
}

/**
 * Response from requesting a BMD export
 */
export interface BmdExportResponse {
  success: boolean;
  exportId: string;
}

/**
 * Progress tracking for BMD export jobs
 */
export interface BmdExportProgress {
  phase: BmdExportPhase;
  current: number;
  total: number;
  currentEntity?: string;
}

/**
 * Counts of exported entities in a BMD export
 */
export interface BmdExportCounts {
  transactions: number;
  files: number;
  partners: number;
  kreditoren: number;
  debitoren: number;
}

/**
 * A BMD export job record
 * Stored in the `bmdExports` collection
 */
export interface BmdExport {
  id: string;
  userId: string;
  status: BmdExportStatus;

  // Request params
  dateFrom: Timestamp;
  dateTo: Timestamp;
  /** Only export complete transactions (with receipts OR no-receipt category). Field name kept for backward compat. */
  onlyWithFiles: boolean;
  includeFiles: boolean;

  // Progress tracking
  progress: BmdExportProgress;

  // Entity counts
  counts: BmdExportCounts;

  // Result (when completed)
  downloadUrl?: string;
  storagePath?: string;
  zipSize?: number;
  expiresAt?: Timestamp;

  // Error handling
  error?: string;
  retryCount: number;
  maxRetries: number;

  // Timestamps
  createdAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
}

/**
 * BMD Buchung (booking) CSV row structure
 */
export interface BmdBuchungRow {
  satzart: number; // Record type (0 = booking entry)
  konto: string; // Person account number
  gkto: string; // Contra account
  belegnr: string; // Document number
  buchdat: string; // Booking date (YYYYMMDD)
  belegdat: string; // Document date (YYYYMMDD)
  betrag: string; // Gross amount
  bucod: number; // 1 = Debit, 2 = Credit
  steuer: string; // VAT amount
  mwst: number; // VAT rate percentage
  text: string; // Booking text
  extbelegnr: string; // External document reference
  symbol: string; // Booking symbol (ER/AR)
  uidnr: string; // VAT ID
}

/**
 * BMD Personenkonto (person account) CSV row structure
 */
export interface BmdPersonenkontoRow {
  konto: string; // Account number (2xxxxx = Kreditor, 3xxxxx = Debitor)
  name: string; // Company/person name
  strasse: string; // Street address
  plz: string; // Postal code
  ort: string; // City
  land: string; // Country code (ISO 2-char)
  uidnr: string; // VAT ID
  telefon: string; // Phone
  email: string; // Email
  iban: string; // IBAN
  matchcode: string; // Search code
}

/**
 * Manifest file structure inside the BMD export ZIP
 */
export interface BmdExportManifest {
  version: string;
  format: "BMD-NTCS";
  exportDate: string;
  userId: string;
  exportId: string;
  dateRange: {
    from: string;
    to: string;
  };
  counts: BmdExportCounts;
  includesFiles: boolean;
}

/**
 * Export expiration period in days
 */
export const BMD_EXPORT_EXPIRY_DAYS = 7;

/**
 * Current BMD export format version
 */
export const BMD_EXPORT_FORMAT_VERSION = "1.0";

/**
 * Base account numbers for Kreditoren and Debitoren
 */
export const KREDITOR_ACCOUNT_BASE = 200000;
export const DEBITOR_ACCOUNT_BASE = 300000;
