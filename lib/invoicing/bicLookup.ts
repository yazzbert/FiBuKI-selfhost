/**
 * Tiny static IBAN -> BIC lookup for common AT/DE banks.
 * Used to derive a BIC for the EPC QR (Girocode) payload.
 * EPC spec allows empty BIC, so a miss is fine.
 *
 * Keep in sync with functions/src/invoicing/bicLookup.ts
 *
 * Strategy:
 * - For AT: first 5 digits of the bank code (positions 5..10 of the IBAN).
 * - For DE: first 8 digits of the bank code (positions 5..13 of the IBAN).
 * Note: Many banks publish exact lookup tables. This is intentionally minimal.
 */

const AT_BIC_BY_BANKCODE: Record<string, string> = {
  // Bank Austria UniCredit (BACA)
  "12000": "BKAUATWW",
  // Erste Bank (Sparkassen) — central GIRO
  "20111": "GIBAATWWXXX",
  // Raiffeisenlandesbank NÖ-Wien
  "32000": "RLNWATWW",
  // BAWAG P.S.K.
  "14000": "BAWAATWW",
  "60000": "OPSKATWW",
  // Volksbank Wien
  "43000": "VBOEATWWXXX",
  // Hypo NÖ
  "53000": "HYPNATWW",
  // Easybank
  "14200": "EASYATW1",
  // ING (AT)
  "19190": "INGBATWW",
  // N26 (AT — via DE)
  "19010": "BCEELULL",
  // Dadat / Schelhammer Capital Bank
  "19420": "SCBKAT21",
  // Bankhaus Spängler
  "19500": "SPAEAT2S",
};

const DE_BIC_BY_BANKCODE: Record<string, string> = {
  // Sparkasse leading codes (10050000 = Berliner Sparkasse, just as a representative entry)
  "10050000": "BELADEBEXXX",
  // Deutsche Bank
  "10070000": "DEUTDEBBXXX",
  // Commerzbank
  "10040000": "COBADEFFXXX",
  // ING-DiBa
  "50010517": "INGDDEFFXXX",
  // DKB
  "12030000": "BYLADEM1001",
  // N26
  "10011001": "NTSBDEB1XXX",
  // Postbank
  "10010010": "PBNKDEFFXXX",
  // Volksbank/Raiffeisen (DZ Bank central)
  "10090000": "GENODEF1S10",
};

function sanitize(iban: string): string {
  return (iban || "").replace(/\s+/g, "").toUpperCase();
}

export function bicFromIban(iban: string): string | undefined {
  const clean = sanitize(iban);
  if (clean.length < 8) return undefined;
  const country = clean.slice(0, 2);
  if (country === "AT") {
    const bankCode = clean.slice(4, 9); // 5 digits
    return AT_BIC_BY_BANKCODE[bankCode];
  }
  if (country === "DE") {
    const bankCode = clean.slice(4, 12); // 8 digits
    return DE_BIC_BY_BANKCODE[bankCode];
  }
  return undefined;
}
