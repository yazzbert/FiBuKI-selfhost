/**
 * Date parsing and matching utilities for invoice replay.
 * Handles common invoice date formats across locales.
 */
(function () {
  "use strict";

  var MONTHS_EN = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  var MONTHS_DE = {
    jan: 0, januar: 0, "jän": 0, "jänner": 0,
    feb: 1, februar: 1,
    "mär": 2, "märz": 2, mar: 2,
    apr: 3, april: 3,
    mai: 4,
    jun: 5, juni: 5,
    jul: 6, juli: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    okt: 9, oktober: 9,
    nov: 10, november: 10,
    dez: 11, dezember: 11,
  };

  /**
   * Parse a date string into a Date object.
   * Supported formats:
   *   DD.MM.YYYY, DD/MM/YYYY (European)
   *   YYYY-MM-DD (ISO)
   *   MM/DD/YYYY (US — only if month > 12 detection fails)
   *   "Jan 15, 2025", "15 Jan 2025", "January 15, 2025"
   *   "15. Jänner 2025" (German)
   * Returns null if unparseable.
   */
  function parseInvoiceDate(text) {
    if (!text || typeof text !== "string") return null;
    var trimmed = text.trim();

    // ISO: YYYY-MM-DD
    var isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return makeDate(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10), parseInt(isoMatch[3], 10));
    }

    // European: DD.MM.YYYY or DD/MM/YYYY
    var euMatch = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (euMatch) {
      var d = parseInt(euMatch[1], 10);
      var m = parseInt(euMatch[2], 10);
      var y = parseInt(euMatch[3], 10);
      // If first number > 12, it must be day (DD.MM.YYYY)
      // If second number > 12, first is month (MM/DD/YYYY)
      if (d > 12) {
        return makeDate(y, m, d);
      } else if (m > 12) {
        return makeDate(y, d, m);
      }
      // Ambiguous — assume European (DD.MM.YYYY) since most invoices are European
      return makeDate(y, m, d);
    }

    // US: MM/DD/YYYY (with 4-digit year)
    var usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) {
      return makeDate(parseInt(usMatch[3], 10), parseInt(usMatch[1], 10), parseInt(usMatch[2], 10));
    }

    // Named month: "Jan 15, 2025" or "15 Jan 2025" or "January 15, 2025"
    var namedMatch = trimmed.match(/(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})/);
    if (namedMatch) {
      var monthName = namedMatch[2].toLowerCase();
      var monthNum = lookupMonth(monthName);
      if (monthNum !== null) {
        return makeDate(parseInt(namedMatch[3], 10), monthNum + 1, parseInt(namedMatch[1], 10));
      }
    }

    var namedMatch2 = trimmed.match(/([A-Za-zÄÖÜäöü]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (namedMatch2) {
      var monthName2 = namedMatch2[1].toLowerCase();
      var monthNum2 = lookupMonth(monthName2);
      if (monthNum2 !== null) {
        return makeDate(parseInt(namedMatch2[3], 10), monthNum2 + 1, parseInt(namedMatch2[2], 10));
      }
    }

    return null;
  }

  function lookupMonth(name) {
    if (MONTHS_EN.hasOwnProperty(name)) return MONTHS_EN[name];
    if (MONTHS_DE.hasOwnProperty(name)) return MONTHS_DE[name];
    // Try without trailing dot/period
    var clean = name.replace(/\.$/, "");
    if (MONTHS_EN.hasOwnProperty(clean)) return MONTHS_EN[clean];
    if (MONTHS_DE.hasOwnProperty(clean)) return MONTHS_DE[clean];
    return null;
  }

  function makeDate(year, month, day) {
    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    var d = new Date(year, month - 1, day);
    // Verify the date is valid (catches Feb 30, etc.)
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  /**
   * Compare two dates with a tolerance window.
   * Invoice date vs bank posting date can differ by days/weeks.
   * Returns true if dates are within windowDays of each other.
   */
  function datesMatch(a, b, windowDays) {
    if (!a || !b) return false;
    if (typeof windowDays !== "number") windowDays = 14;
    var diffMs = Math.abs(a.getTime() - b.getTime());
    var diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= windowDays;
  }

  // Expose globally for other extension scripts
  window.__tsDateParser = {
    parseInvoiceDate: parseInvoiceDate,
    datesMatch: datesMatch,
  };
})();
