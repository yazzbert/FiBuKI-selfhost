/**
 * Amount parsing and matching utilities for invoice replay.
 * Handles European (1.234,56) and US (1,234.56) formats.
 * All amounts are normalized to integer cents to avoid floating point issues.
 */
(function () {
  "use strict";

  /**
   * Parse a text string containing a monetary amount into integer cents.
   * Handles: "€ 1.234,56", "$1,234.56", "-123.45", "1234,56 EUR", "1 234,56"
   * Returns null if no valid amount found.
   */
  function parseAmount(text) {
    if (!text || typeof text !== "string") return null;

    // Strip currency symbols and codes
    var cleaned = text
      .replace(/[€$£¥₹]/g, "")
      .replace(/\b(EUR|USD|GBP|CHF|JPY|AUD|CAD|SEK|NOK|DKK|CZK|PLN|HUF|RON|BGN|HRK|ISK|TRY)\b/gi, "")
      .trim();

    // Remove non-breaking spaces
    cleaned = cleaned.replace(/\u00A0/g, " ");

    // Detect negative (prefix minus, parentheses, trailing minus)
    var isNegative = false;
    if (/^\s*-/.test(cleaned) || /^\s*\(.*\)\s*$/.test(cleaned) || /-\s*$/.test(cleaned)) {
      isNegative = true;
    }

    // Strip everything except digits, dots, commas, spaces
    cleaned = cleaned.replace(/[^0-9.,\s]/g, "").trim();
    if (!cleaned) return null;

    // Remove spaces used as thousand separators (e.g., "1 234,56")
    cleaned = cleaned.replace(/\s/g, "");

    // Determine decimal separator:
    // If comma appears after the last dot: European format (1.234,56)
    // If dot appears after the last comma: US format (1,234.56)
    // If only comma: could be European decimal (123,45) or thousand (1,234)
    // If only dot: could be US decimal (123.45) or thousand (1.234)
    var lastDot = cleaned.lastIndexOf(".");
    var lastComma = cleaned.lastIndexOf(",");

    var integerPart, decimalPart;

    if (lastComma > lastDot) {
      // European: comma is decimal separator
      // "1.234,56" -> integer "1234", decimal "56"
      integerPart = cleaned.substring(0, lastComma).replace(/[.,]/g, "");
      decimalPart = cleaned.substring(lastComma + 1);
    } else if (lastDot > lastComma) {
      // US: dot is decimal separator
      // "1,234.56" -> integer "1234", decimal "56"
      integerPart = cleaned.substring(0, lastDot).replace(/[.,]/g, "");
      decimalPart = cleaned.substring(lastDot + 1);
    } else if (lastComma >= 0 && lastDot < 0) {
      // Only commas — check if it's a decimal or thousand separator
      var afterComma = cleaned.substring(lastComma + 1);
      if (afterComma.length === 2) {
        // Likely European decimal: "123,45"
        integerPart = cleaned.substring(0, lastComma);
        decimalPart = afterComma;
      } else if (afterComma.length === 3 && cleaned.indexOf(",") === lastComma) {
        // Could be thousand separator: "1,234" — treat as integer 1234
        integerPart = cleaned.replace(/,/g, "");
        decimalPart = "00";
      } else {
        // Multiple commas as thousand separators: "1,234,567"
        integerPart = cleaned.replace(/,/g, "");
        decimalPart = "00";
      }
    } else if (lastDot >= 0 && lastComma < 0) {
      // Only dots — check if it's a decimal or thousand separator
      var afterDot = cleaned.substring(lastDot + 1);
      if (afterDot.length === 2) {
        // Likely decimal: "123.45"
        integerPart = cleaned.substring(0, lastDot);
        decimalPart = afterDot;
      } else if (afterDot.length === 3 && cleaned.indexOf(".") === lastDot) {
        // Could be thousand separator: "1.234" — ambiguous, but assume decimal
        // since amount comparison has tolerance
        integerPart = cleaned.substring(0, lastDot);
        decimalPart = afterDot;
      } else {
        // Multiple dots as thousand separators: "1.234.567"
        integerPart = cleaned.replace(/\./g, "");
        decimalPart = "00";
      }
    } else {
      // No separators: "12345"
      integerPart = cleaned;
      decimalPart = "00";
    }

    if (!integerPart) integerPart = "0";

    // Pad or truncate decimal to 2 digits
    if (decimalPart.length === 0) decimalPart = "00";
    else if (decimalPart.length === 1) decimalPart = decimalPart + "0";
    else if (decimalPart.length > 2) decimalPart = decimalPart.substring(0, 2);

    var cents = parseInt(integerPart, 10) * 100 + parseInt(decimalPart, 10);
    if (isNaN(cents)) return null;

    return isNegative ? -cents : cents;
  }

  /**
   * Compare two amounts (in cents) with tolerance.
   * Returns true if they match within the specified tolerance.
   */
  function amountsMatch(a, b, toleranceCents) {
    if (a === null || b === null) return false;
    if (typeof toleranceCents !== "number") toleranceCents = 2;
    // Compare absolute values (transaction amounts can be negative)
    return Math.abs(Math.abs(a) - Math.abs(b)) <= toleranceCents;
  }

  // Expose globally for other extension scripts
  window.__tsAmountParser = {
    parseAmount: parseAmount,
    amountsMatch: amountsMatch,
  };
})();
