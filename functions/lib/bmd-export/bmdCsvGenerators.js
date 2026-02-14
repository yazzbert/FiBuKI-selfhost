"use strict";
/**
 * BMD NTCS CSV generation helpers.
 * Generates semicolon-separated CSV content in BMD-compatible format.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_RECEIPT_SACHKONTO_MAP = void 0;
exports.formatBmdDate = formatBmdDate;
exports.formatBmdAmount = formatBmdAmount;
exports.escapeBmdCsv = escapeBmdCsv;
exports.createMatchcode = createMatchcode;
exports.generatePersonenkontoNumber = generatePersonenkontoNumber;
exports.generatePersonenkontenCsv = generatePersonenkontenCsv;
exports.generateBuchungenCsv = generateBuchungenCsv;
exports.generateFileMapping = generateFileMapping;
const firestore_1 = require("firebase-admin/firestore");
const bmd_export_1 = require("../types/bmd-export");
/**
 * Maps no-receipt category templateIds to BMD Sachkonten.
 * expense/income = null means the category doesn't apply for that direction.
 */
exports.NO_RECEIPT_SACHKONTO_MAP = {
    "bank-fees": { expense: "7780", income: null, symbol: "BK", name: "Bankspesen" },
    "interest": { expense: "7810", income: "8100", symbol: "BK", name: "Zinsen" },
    "internal-transfers": { expense: "2800", income: "2800", symbol: "UM", name: "Umbuchung" },
    "payment-provider-settlements": { expense: "7780", income: null, symbol: "BK", name: "PSP-Spesen" },
    "taxes-government": { expense: "3520", income: null, symbol: "BK", name: "Steuern/Abgaben" },
    "payroll": { expense: "6200", income: null, symbol: "GH", name: "Gehalt" },
    "private-personal": { expense: "9600", income: "9600", symbol: "PR", name: "Privat" },
    "zero-value": { expense: null, income: null, symbol: "", name: "" },
    "receipt-lost": { expense: "7000", income: "4000", symbol: "ER", name: "Eigenbeleg" },
};
/**
 * Format date as YYYYMMDD for BMD
 */
function formatBmdDate(date) {
    if (!date)
        return "";
    const d = date instanceof firestore_1.Timestamp ? date.toDate() : date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
}
/**
 * Format amount for BMD (positive decimal with comma as separator)
 * Amount is stored in cents, convert to euros with 2 decimal places
 */
function formatBmdAmount(amountInCents) {
    if (amountInCents === undefined || amountInCents === null)
        return "0,00";
    const absAmount = Math.abs(amountInCents) / 100;
    return absAmount.toFixed(2).replace(".", ",");
}
/**
 * Escape a value for BMD CSV (uses semicolon separator)
 */
function escapeBmdCsv(value) {
    if (value === undefined || value === null)
        return "";
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
function createMatchcode(name) {
    if (!name)
        return "";
    return name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .substring(0, 20);
}
/**
 * Generate a Personenkonto number for a partner
 * Kreditoren (suppliers): 2xxxxx
 * Debitoren (customers): 3xxxxx
 */
function generatePersonenkontoNumber(partnerId, isKreditor, partnerIndex) {
    let index = partnerIndex.get(partnerId);
    if (index === undefined) {
        index = partnerIndex.size + 1;
        partnerIndex.set(partnerId, index);
    }
    const base = isKreditor ? bmd_export_1.KREDITOR_ACCOUNT_BASE : bmd_export_1.DEBITOR_ACCOUNT_BASE;
    return String(base + index);
}
/**
 * Generate Personenkonten CSV content
 */
function generatePersonenkontenCsv(partners, partnerIndex) {
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
        const row = {
            konto: generatePersonenkontoNumber(partner.id, partner.isKreditor, partnerIndex),
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
    const csvRows = rows.map((row) => headers
        .map((h) => escapeBmdCsv(row[h]))
        .join(";"));
    return [headers.join(";"), ...csvRows].join("\n");
}
/**
 * Generate Buchungen CSV content
 */
function generateBuchungenCsv(transactions, files, partnerIndex, startBelegnr = 1) {
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
    const rows = [];
    let belegnrCounter = startBelegnr;
    for (const tx of transactions) {
        const isExpense = tx.amount < 0;
        const isKreditor = isExpense;
        const hasFiles = tx.fileIds && tx.fileIds.length > 0;
        const templateId = tx.noReceiptCategoryTemplateId;
        const categoryMapping = templateId ? exports.NO_RECEIPT_SACHKONTO_MAP[templateId] : undefined;
        const isCategoryTransaction = !!templateId && !!categoryMapping;
        // Skip zero-value category entirely
        if (templateId === "zero-value") {
            belegnrCounter++;
            continue;
        }
        // Get document date from first connected file, or use transaction date
        const firstFileId = tx.fileIds?.[0];
        const firstFile = firstFileId ? files.get(firstFileId) : undefined;
        const belegdat = firstFile?.extractedDate || tx.date;
        // Generate Belegnummer (YYYYNNNNNN format)
        const year = tx.date.toDate().getFullYear();
        const belegnr = `${year}${String(belegnrCounter).padStart(6, "0")}`;
        belegnrCounter++;
        // Preferred display name: resolved partner name > raw bank partner > tx name
        const displayName = tx.partnerName || tx.partner || tx.name || "";
        // External document reference (file names)
        const extbelegnr = tx.fileIds
            ?.map((fid) => files.get(fid)?.fileName)
            .filter(Boolean)
            .join(", ")
            .substring(0, 50) || "";
        let row;
        if (isCategoryTransaction && !hasFiles) {
            // --- No-receipt category path ---
            const sachkonto = (isExpense ? categoryMapping.expense : categoryMapping.income)
                || (isExpense ? "7000" : "4000"); // fallback
            // VAT: 0% for all categories except receipt-lost (keeps tx vatRate)
            const isReceiptLost = templateId === "receipt-lost";
            const vatRate = isReceiptLost ? (tx.vatRate ?? 20) : 0;
            const vatAmount = isReceiptLost
                ? (tx.vatAmount ?? Math.round((Math.abs(tx.amount) * vatRate) / (100 + vatRate)))
                : 0;
            const text = `${categoryMapping.name}: ${displayName}`.substring(0, 75);
            row = {
                satzart: 0,
                konto: sachkonto,
                gkto: "", // empty — BMD assigns bank side on import
                belegnr,
                buchdat: formatBmdDate(tx.date),
                belegdat: formatBmdDate(belegdat),
                betrag: formatBmdAmount(tx.amount),
                bucod: isExpense ? 1 : 2,
                steuer: formatBmdAmount(vatAmount),
                mwst: vatRate,
                text,
                extbelegnr,
                symbol: categoryMapping.symbol || (isExpense ? "ER" : "AR"),
                uidnr: (tx.vatId || "").substring(0, 20),
            };
        }
        else {
            // --- Standard transaction path (has files, or no category) ---
            const personenkonto = tx.partnerId
                ? generatePersonenkontoNumber(tx.partnerId, isKreditor, partnerIndex)
                : isKreditor
                    ? String(bmd_export_1.KREDITOR_ACCOUNT_BASE + 1)
                    : String(bmd_export_1.DEBITOR_ACCOUNT_BASE + 1);
            const contraAccount = isExpense ? "7000" : "4000";
            const vatRate = tx.vatRate ?? 20;
            const vatAmount = tx.vatAmount ??
                Math.round((Math.abs(tx.amount) * vatRate) / (100 + vatRate));
            row = {
                satzart: 0,
                konto: personenkonto,
                gkto: contraAccount,
                belegnr,
                buchdat: formatBmdDate(tx.date),
                belegdat: formatBmdDate(belegdat),
                betrag: formatBmdAmount(tx.amount),
                bucod: isExpense ? 1 : 2,
                steuer: formatBmdAmount(vatAmount),
                mwst: vatRate,
                text: displayName.substring(0, 75),
                extbelegnr,
                symbol: isExpense ? "ER" : "AR",
                uidnr: (tx.vatId || "").substring(0, 20),
            };
        }
        rows.push(row);
    }
    const csvRows = rows.map((row) => headers
        .map((h) => escapeBmdCsv(row[h]))
        .join(";"));
    return [headers.join(";"), ...csvRows].join("\n");
}
/**
 * Generate a mapping of belegnr to file IDs for ZIP file naming
 */
function generateFileMapping(transactions, startBelegnr = 1) {
    const mapping = new Map();
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
//# sourceMappingURL=bmdCsvGenerators.js.map