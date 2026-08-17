/**
 * Import date-format detection (fork #70).
 *
 * `us` (MM/DD/YYYY) and `eu-slash` (DD/MM/YYYY) carry identical patterns, so
 * auto-detection used to resolve the tie by array position and silently swap
 * day and month on any European column whose sampled days all sit at 12 or
 * below. For an Austrian tool that moves transactions between UVA periods.
 *
 * Covers repo-root lib/import/date-parsers.ts, so it runs under
 * vitest.api-smoke.config.ts ONLY (needs root node_modules for date-fns).
 */

import { describe, it, expect, vi } from "vitest";

// field-matcher pulls the AI matcher, which imports the browser Firebase SDK.
// The rule-based path under test never calls it.
vi.mock("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock("@/lib/firebase/config", () => ({ functions: {}, db: {}, auth: {} }));

import {
  detectDateFormat,
  analyzeDayMonthOrder,
  findDateColumnConflict,
  looksLikeDateColumn,
  parseDate,
} from "@/lib/import/date-parsers";
import { autoMatchColumnsRuleBased } from "@/lib/import/field-matcher";

describe("analyzeDayMonthOrder", () => {
  it("proves day-first when a first component exceeds 12", () => {
    expect(analyzeDayMonthOrder(["03/07/2026", "31/07/2026"])).toBe("day-first");
  });

  it("proves month-first when a second component exceeds 12", () => {
    expect(analyzeDayMonthOrder(["07/03/2026", "07/31/2026"])).toBe("month-first");
  });

  it("reports no evidence when every component could be either", () => {
    expect(analyzeDayMonthOrder(["03/07/2026", "05/06/2026", "01/02/2026"])).toBe("none");
  });

  it("reports a conflict when the column proves both", () => {
    expect(analyzeDayMonthOrder(["31/07/2026", "07/31/2026"])).toBe("conflict");
  });

  it("reads dots and dashes, not just slashes", () => {
    expect(analyzeDayMonthOrder(["31.07.2026"])).toBe("day-first");
    expect(analyzeDayMonthOrder(["07-31-2026"])).toBe("month-first");
  });

  it("ignores values that carry no day/month ambiguity", () => {
    expect(analyzeDayMonthOrder(["2026-07-31", "31 July 2026", "31-Jul-2026", ""])).toBe("none");
  });

  it("reads the whole column, not a leading slice", () => {
    const column = [...Array(200).fill("03/07/2026"), "31/07/2026"];

    expect(analyzeDayMonthOrder(column)).toBe("day-first");
  });
});

describe("detectDateFormat", () => {
  it("picks the European parser when the column proves day-first", () => {
    const samples = ["03/07/2026", "15/07/2026", "31/07/2026", "01/08/2026"];

    expect(detectDateFormat(samples)).toBe("eu-slash");
  });

  it("picks the US parser when the column proves month-first", () => {
    const samples = ["07/03/2026", "07/15/2026", "07/31/2026", "08/01/2026"];

    expect(detectDateFormat(samples)).toBe("us");
  });

  it("refuses to guess when the column proves neither", () => {
    // The silent-swap case: every day is 12 or lower, so both parsers score
    // identically. Guessing here is what wrote 3 July in as 7 March.
    const samples = ["03/07/2026", "05/06/2026", "01/02/2026", "11/12/2026"];

    expect(detectDateFormat(samples)).toBeNull();
  });

  it("refuses to guess when the column proves both", () => {
    expect(detectDateFormat(["31/07/2026", "07/31/2026", "01/02/2026"])).toBeNull();
  });

  it("still detects the unambiguous formats", () => {
    expect(detectDateFormat(["2026-07-31", "2026-08-01"])).toBe("iso");
    expect(detectDateFormat(["2026-07-31 10:15:00"])).toBe("iso-datetime");
    expect(detectDateFormat(["2026-07-31T10:15:00"])).toBe("iso-datetime-t");
    expect(detectDateFormat(["31.07.2026", "01.08.2026"])).toBe("de");
    expect(detectDateFormat(["31-Jul-2026"])).toBe("text-short");
    expect(detectDateFormat(["31 July 2026"])).toBe("text-long");
  });

  it("keeps requiring half the column to parse", () => {
    expect(detectDateFormat(["not a date", "also not", "31/07/2026"])).toBeNull();
  });

  it("returns null for an empty column", () => {
    expect(detectDateFormat([])).toBeNull();
    expect(detectDateFormat(["", "  "])).toBeNull();
  });

  it("resolves the tie the same way whatever the row order", () => {
    const proving = ["31/07/2026", "03/07/2026", "05/06/2026"];

    expect(detectDateFormat(proving)).toBe("eu-slash");
    expect(detectDateFormat([...proving].reverse())).toBe("eu-slash");
  });
});

describe("looksLikeDateColumn", () => {
  it("recognises a date column whose day/month order is unresolved", () => {
    // detectDateFormat refuses to name a parser here, but the column is still
    // a date column — it must not fall through to amount or no-match.
    const samples = ["03/07/2026", "05/06/2026", "01/02/2026"];

    expect(detectDateFormat(samples)).toBeNull();
    expect(looksLikeDateColumn(samples)).toBe(true);
  });

  it("recognises the unambiguous formats", () => {
    expect(looksLikeDateColumn(["2026-07-31"])).toBe(true);
    expect(looksLikeDateColumn(["31.07.2026", "01.08.2026"])).toBe(true);
  });

  it("rejects columns that are not dates", () => {
    expect(looksLikeDateColumn(["Amazon", "Netflix"])).toBe(false);
    expect(looksLikeDateColumn(["-25.00", "1200.50"])).toBe(false);
    expect(looksLikeDateColumn([])).toBe(false);
  });
});

describe("findDateColumnConflict", () => {
  it("flags a month-first parser on a column that proves day-first", () => {
    const conflict = findDateColumnConflict(["03/07/2026", "31/07/2026"], "us");

    expect(conflict).not.toBeNull();
    expect(conflict?.evidence).toBe("day-first");
    expect(conflict?.suggestedParserId).toBe("eu-slash");
  });

  it("flags a day-first parser on a column that proves month-first", () => {
    const conflict = findDateColumnConflict(["07/31/2026"], "eu-slash");

    expect(conflict?.evidence).toBe("month-first");
    expect(conflict?.suggestedParserId).toBe("us");
  });

  it("flags a column that proves both, with no parser to suggest", () => {
    const conflict = findDateColumnConflict(["31/07/2026", "07/31/2026"], "eu-slash");

    expect(conflict?.evidence).toBe("conflict");
    expect(conflict?.suggestedParserId).toBeNull();
  });

  it("passes a parser that agrees with the evidence", () => {
    expect(findDateColumnConflict(["03/07/2026", "31/07/2026"], "eu-slash")).toBeNull();
    expect(findDateColumnConflict(["07/31/2026"], "us")).toBeNull();
  });

  it("passes a column with no evidence — an explicit choice is respected", () => {
    expect(findDateColumnConflict(["03/07/2026", "05/06/2026"], "us")).toBeNull();
  });

  it("passes formats that cannot swap day and month", () => {
    expect(findDateColumnConflict(["2026-07-31"], "iso")).toBeNull();
    expect(findDateColumnConflict(["31-Jul-2026"], "text-short")).toBeNull();
  });

  it("passes an unknown parser id rather than throwing", () => {
    expect(findDateColumnConflict(["03/07/2026"], "no-such-parser")).toBeNull();
  });
});

describe("parseDate still reads what detection selected", () => {
  it("reads a proven European column as day-first", () => {
    const parsed = parseDate("03/07/2026", "eu-slash");

    expect(parsed?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
  });

  it("reads a proven US column as month-first", () => {
    const parsed = parseDate("07/03/2026", "us");

    expect(parsed?.toISOString()).toBe("2026-07-03T00:00:00.000Z");
  });
});

describe("rule-based column matching (#70 end to end)", () => {
  const rows = (dates: string[]) =>
    dates.map((date, i) => ({ Buchungstag: date, Betrag: `-${10 + i},00`, Name: "Partner" }));

  it("suggests the European parser when the column proves day-first", async () => {
    const mappings = await autoMatchColumnsRuleBased(
      ["Buchungstag", "Betrag", "Name"],
      rows(["03/07/2026", "05/06/2026", "31/07/2026"])
    );
    const date = mappings.find((m) => m.csvColumn === "Buchungstag");

    expect(date?.targetField).toBe("date");
    expect(date?.format).toBe("eu-slash");
  });

  it("keeps the column as a date but leaves the format unset when unproven", async () => {
    const mappings = await autoMatchColumnsRuleBased(
      ["Buchungstag", "Betrag", "Name"],
      rows(["03/07/2026", "05/06/2026", "01/02/2026"])
    );
    const date = mappings.find((m) => m.csvColumn === "Buchungstag");

    expect(date?.targetField).toBe("date");
    expect(date?.format).toBeUndefined();
  });

  it("reads past the 10-value sample to find the proving row", async () => {
    const dates = [...Array(20).fill("03/07/2026"), "31/07/2026"];

    const mappings = await autoMatchColumnsRuleBased(
      ["Buchungstag", "Betrag", "Name"],
      rows(dates)
    );

    expect(mappings.find((m) => m.csvColumn === "Buchungstag")?.format).toBe("eu-slash");
  });
});
