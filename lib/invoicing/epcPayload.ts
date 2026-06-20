/**
 * EPC / Girocode QR payload builder per EPC069-12 v2.0.
 *
 * Keep in sync with functions/src/invoicing/epcPayload.ts
 *
 * Layout (lines separated by LF):
 *   BCD                          (service tag)
 *   002                          (version)
 *   1                            (char set: 1 = UTF-8)
 *   SCT                          (identification: SEPA Credit Transfer)
 *   {bic}                        (recipient BIC, optional in v2)
 *   {beneficiary name}           (max 70)
 *   {iban}                       (no spaces)
 *   EUR{amount}                  (amount, EUR with 2 decimals using dot)
 *   {purpose}                    (4 chars, optional)
 *   {structured reference}       (max 35)
 *   {unstructured remittance}    (max 140)
 *   {beneficiary note}           (max 70, optional)
 *
 * Either structured reference OR unstructured remittance must be empty.
 */

export interface EpcPayloadInput {
  /** SEPA-routing BIC. Optional in v2 (line left empty). */
  bic?: string;
  /** Beneficiary name (max 70 chars). */
  name: string;
  /** IBAN, spaces stripped. */
  iban: string;
  /** Total amount in cents (EUR only). */
  amountCents: number;
  /** Unstructured remittance info (max 140 chars). */
  remittance?: string;
  /** Optional purpose code (4 chars). */
  purpose?: string;
}

function asciiSafe(input: string, maxLen: number): string {
  // Strip control chars; collapse whitespace; clamp to maxLen.
  const cleaned = (input || "")
    .replace(/[ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen);
}

function formatAmountEur(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  const euros = Math.floor(safe / 100);
  const remainder = safe % 100;
  return `EUR${euros}.${String(remainder).padStart(2, "0")}`;
}

export function buildEpcPayload(input: EpcPayloadInput): string {
  const bic = input.bic ? asciiSafe(input.bic, 11) : "";
  const name = asciiSafe(input.name, 70);
  const iban = (input.iban || "").replace(/\s+/g, "").toUpperCase();
  const amount = formatAmountEur(input.amountCents);
  const purpose = input.purpose ? asciiSafe(input.purpose, 4) : "";
  const remittance = input.remittance ? asciiSafe(input.remittance, 140) : "";

  // 11 lines per EPC069-12 v2 (last 'beneficiary note' line omitted for brevity)
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    bic,
    name,
    iban,
    amount,
    purpose,
    "", // structured reference (empty when using unstructured remittance)
    remittance,
  ].join("\n");
}
