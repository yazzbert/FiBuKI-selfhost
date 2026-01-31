/**
 * BMD NTCS CSV generation helpers.
 * Generates semicolon-separated CSV content in BMD-compatible format.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  BmdBuchungRow,
  BmdPersonenkontoRow,
  KREDITOR_ACCOUNT_BASE,
  DEBITOR_ACCOUNT_BASE,
} from "../types/bmd-export";

/**
 * Format date as YYYYMMDD for BMD
 */
export function formatBmdDate(date: Timestamp | Date | undefined): string {
  if (!date) return "";
  const d = date instanceof Timestamp ? date.toDate() : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Format amount for BMD (positive decimal with comma as separator)
 * Amount is stored in cents, convert to euros with 2 decimal places
 */
export function formatBmdAmount(amountInCents: number | undefined): string {
  if (amountInCents === undefined || amountInCents === null) return "0,00";
  const absAmount = Math.abs(amountInCents) / 100;
  return absAmount.toFixed(2).replace(".", ",");
}

/**
 * Escape a value for BMD CSV (uses semicolon separator)
 */
export function escapeBmdCsv(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  // Escape quotes and wrap if contains semicolon, quote, or newline
  if (str.includes(";") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Create a matchcode from partner name (uppercase alphanumeric, max 20 chars)
 */
export function createMatchcode(name: string | undefined): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .substring(0, 20);
}

/**
 * Partner account number index - tracks assigned account numbers
 */
export type PartnerAccountIndex = Map<string, number>;

/**
 * Generate a Personenkonto number for a partner
 * Kreditoren (suppliers): 2xxxxx
 * Debitoren (customers): 3xxxxx
 */
export function generatePersonenkontoNumber(
  partnerId: string,
  isKreditor: boolean,
  partnerIndex: PartnerAccountIndex
): string {
  let index = partnerIndex.get(partnerId);
  if (index === undefined) {
    index = partnerIndex.size + 1;
    partnerIndex.set(partnerId, index);
  }

  const base = isKreditor ? KREDITOR_ACCOUNT_BASE : DEBITOR_ACCOUNT_BASE;
  return String(base + index);
}

/**
 * Partner data for export
 */
export interface PartnerForExport {
  id: string;
  name?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  vatId?: string;
  ibans?: string[];
  email?: string;
  phone?: string;
  isKreditor: boolean;
}

/**
 * Generate Personenkonten CSV content
 */
export function generatePersonenkontenCsv(
  partners: PartnerForExport[],
  partnerIndex: PartnerAccountIndex
): string {
  const headers = [
    "konto",
    "name",
    "strasse",
    "plz",
    "ort",
    "land",
    "uidnr",
    "telefon",
    "email",
    "iban",
    "matchcode",
  ];

  const rows = partners.map((partner) => {
    const row: BmdPersonenkontoRow = {
      konto: generatePersonenkontoNumber(
        partner.id,
        partner.isKreditor,
        partnerIndex
      ),
      name: (partner.name || "").substring(0, 50),
      strasse: (partner.street || "").substring(0, 50),
      plz: (partner.postalCode || "").substring(0, 10),
      ort: (partner.city || "").substring(0, 50),
      land: (partner.country || "AT").substring(0, 2).toUpperCase(),
      uidnr: (partner.vatId || "").substring(0, 20),
      telefon: (partner.phone || "").substring(0, 30),
      email: (partner.email || "").substring(0, 80),
      iban: (partner.ibans?.[0] || "").substring(0, 34),
      matchcode: createMatchcode(partner.name),
    };
    return row;
  });

  const csvRows = rows.map((row) =>
    headers
      .map((h) => escapeBmdCsv(row[h as keyof BmdPersonenkontoRow]))
      .join(";")
  );

  return [headers.join(";"), ...csvRows].join("\n");
}

/**
 * Transaction data for export
 */
export interface TransactionForExport {
  id: string;
  date: Timestamp;
  amount: number; // in cents
  name?: string;
  partnerId?: string;
  fileIds?: string[];
  vatRate?: number;
  vatAmount?: number; // in cents
  vatId?: string;
}

/**
 * File data for export
 */
export interface FileForExport {
  id: string;
  fileName: string;
  extractedDate?: Timestamp;
}

/**
 * Generate Buchungen CSV content
 */
export function generateBuchungenCsv(
  transactions: TransactionForExport[],
  files: Map<string, FileForExport>,
  partnerIndex: PartnerAccountIndex,
  startBelegnr: number = 1
): string {
  const headers = [
    "satzart",
    "konto",
    "gkto",
    "belegnr",
    "buchdat",
    "belegdat",
    "betrag",
    "bucod",
    "steuer",
    "mwst",
    "text",
    "extbelegnr",
    "symbol",
    "uidnr",
  ];

  const rows: BmdBuchungRow[] = [];
  let belegnrCounter = startBelegnr;

  for (const tx of transactions) {
    const isExpense = tx.amount < 0;
    const isKreditor = isExpense;

    // Get document date from first connected file, or use transaction date
    const firstFileId = tx.fileIds?.[0];
    const firstFile = firstFileId ? files.get(firstFileId) : undefined;
    const belegdat = firstFile?.extractedDate || tx.date;

    // Generate Belegnummer (YYYYNNNNNN format)
    const year = tx.date.toDate().getFullYear();
    const belegnr = `${year}${String(belegnrCounter).padStart(6, "0")}`;
    belegnrCounter++;

    // Determine accounts
    const personenkonto = tx.partnerId
      ? generatePersonenkontoNumber(tx.partnerId, isKreditor, partnerIndex)
      : isKreditor
        ? String(KREDITOR_ACCOUNT_BASE + 1)
        : String(DEBITOR_ACCOUNT_BASE + 1); // Default accounts

    // Default contra accounts (generic expense/revenue)
    const contraAccount = isExpense ? "7000" : "4000";

    // VAT calculation
    const vatRate = tx.vatRate ?? 20;
    const vatAmount =
      tx.vatAmount ??
      Math.round((Math.abs(tx.amount) * vatRate) / (100 + vatRate));

    // External document reference (file names)
    const extbelegnr =
      tx.fileIds
        ?.map((fid) => files.get(fid)?.fileName)
        .filter(Boolean)
        .join(", ")
        .substring(0, 50) || "";

    const row: BmdBuchungRow = {
      satzart: 0,
      konto: personenkonto,
      gkto: contraAccount,
      belegnr,
      buchdat: formatBmdDate(tx.date),
      belegdat: formatBmdDate(belegdat),
      betrag: formatBmdAmount(tx.amount),
      bucod: isExpense ? 1 : 2, // 1=Soll (debit), 2=Haben (credit)
      steuer: formatBmdAmount(vatAmount),
      mwst: vatRate,
      text: (tx.name || "").substring(0, 75),
      extbelegnr,
      symbol: isExpense ? "ER" : "AR", // Eingangsrechnung / Ausgangsrechnung
      uidnr: (tx.vatId || "").substring(0, 20),
    };

    rows.push(row);
  }

  const csvRows = rows.map((row) =>
    headers
      .map((h) => escapeBmdCsv(row[h as keyof BmdBuchungRow]))
      .join(";")
  );

  return [headers.join(";"), ...csvRows].join("\n");
}

/**
 * Generate a mapping of belegnr to file IDs for ZIP file naming
 */
export function generateFileMapping(
  transactions: TransactionForExport[],
  startBelegnr: number = 1
): Map<string, { belegnr: string; fileIds: string[] }> {
  const mapping = new Map<string, { belegnr: string; fileIds: string[] }>();
  let belegnrCounter = startBelegnr;

  for (const tx of transactions) {
    if (tx.fileIds && tx.fileIds.length > 0) {
      const year = tx.date.toDate().getFullYear();
      const belegnr = `${year}${String(belegnrCounter).padStart(6, "0")}`;
      mapping.set(tx.id, { belegnr, fileIds: tx.fileIds });
    }
    belegnrCounter++;
  }

  return mapping;
}
