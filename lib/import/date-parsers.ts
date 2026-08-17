import { parse, isValid } from "date-fns";
import { DateParser } from "@/types/import";

/**
 * Available date format parsers.
 * Order matters - more specific patterns should come first.
 */
export const DATE_PARSERS: DateParser[] = [
  // ISO datetime with time (most specific - must come before date-only)
  {
    id: "iso-datetime",
    name: "ISO DateTime (YYYY-MM-DD HH:mm:ss)",
    pattern: /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/,
    format: "yyyy-MM-dd HH:mm:ss",
  },
  {
    id: "iso-datetime-t",
    name: "ISO DateTime (YYYY-MM-DDTHH:mm:ss)",
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    format: "yyyy-MM-dd'T'HH:mm:ss",
  },
  // ISO date-only format
  {
    id: "iso",
    name: "ISO (YYYY-MM-DD)",
    pattern: /^\d{4}-\d{2}-\d{2}$/,
    format: "yyyy-MM-dd",
  },
  // German formats
  {
    id: "de",
    name: "German (DD.MM.YYYY)",
    pattern: /^\d{2}\.\d{2}\.\d{4}$/,
    format: "dd.MM.yyyy",
  },
  {
    id: "de-short",
    name: "German Short (DD.MM.YY)",
    pattern: /^\d{2}\.\d{2}\.\d{2}$/,
    format: "dd.MM.yy",
  },
  // US formats
  {
    id: "us",
    name: "US (MM/DD/YYYY)",
    pattern: /^\d{2}\/\d{2}\/\d{4}$/,
    format: "MM/dd/yyyy",
  },
  {
    id: "us-short",
    name: "US Short (MM/DD/YY)",
    pattern: /^\d{2}\/\d{2}\/\d{2}$/,
    format: "MM/dd/yy",
  },
  // European with slashes
  {
    id: "eu-slash",
    name: "European (DD/MM/YYYY)",
    pattern: /^\d{2}\/\d{2}\/\d{4}$/,
    format: "dd/MM/yyyy",
  },
  // Dash separated
  {
    id: "dash-dmy",
    name: "Dashed (DD-MM-YYYY)",
    pattern: /^\d{2}-\d{2}-\d{4}$/,
    format: "dd-MM-yyyy",
  },
  // Text month formats
  {
    id: "text-short",
    name: "Text Month Short (DD-MMM-YYYY)",
    pattern: /^\d{2}-[A-Za-z]{3}-\d{4}$/,
    format: "dd-MMM-yyyy",
  },
  {
    id: "text-long",
    name: "Text Month Long (DD MMMM YYYY)",
    pattern: /^\d{2}\s+[A-Za-z]+\s+\d{4}$/,
    format: "dd MMMM yyyy",
  },
];

/**
 * Parse a date string using a specific parser
 */
export function parseDate(value: string, parserId: string): Date | null {
  const parser = DATE_PARSERS.find((p) => p.id === parserId);
  if (!parser) return null;

  const trimmed = value.trim();
  const parsed = parse(trimmed, parser.format, new Date());

  if (!isValid(parsed)) return null;

  // Sanity check: year should be reasonable (1990-2100)
  const year = parsed.getFullYear();
  if (year < 1990 || year > 2100) return null;

  // Normalize to UTC midnight — date-fns parse() creates dates in the browser's
  // local timezone, so extract the local date components (which are correct) and
  // reconstruct as UTC to avoid off-by-one errors in non-UTC timezones.
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

/** Which component a numeric parser reads first. */
export type DayMonthOrder = "day-first" | "month-first";

/**
 * What a column of values proves about its day/month order:
 * a proven order, no proof either way, or values that prove both.
 */
export type DayMonthEvidence = DayMonthOrder | "none" | "conflict";

/** A day/month-ambiguous value: two 1-2 digit components, then a year. */
const NUMERIC_DAY_MONTH = /^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}$/;

/**
 * The order a parser reads, derived from its date-fns format, or null when the
 * format cannot swap day and month (ISO, or a spelled-out month).
 */
export function dayMonthOrderOfFormat(format: string): DayMonthOrder | null {
  const day = format.indexOf("dd");
  // "MMM"/"MMMM" spell the month out, so there is nothing to confuse.
  const month = /MMM/.test(format) ? -1 : format.indexOf("MM");
  if (day === -1 || month === -1) return null;

  return day < month ? "day-first" : "month-first";
}

/**
 * What the values prove about day/month order. Reads EVERY value it is given —
 * a leading slice that happens to hold no day above 12 is exactly the case
 * that produced silently swapped dates.
 *
 * A first component above 12 can only be a day; a second component above 12
 * can only be a month position holding a day. Values that cannot be ambiguous
 * (ISO, text months) contribute nothing either way.
 */
export function analyzeDayMonthOrder(values: string[]): DayMonthEvidence {
  let dayFirst = false;
  let monthFirst = false;

  for (const value of values) {
    const match = NUMERIC_DAY_MONTH.exec(value?.trim() ?? "");
    if (!match) continue;

    const first = Number(match[1]);
    const second = Number(match[2]);

    if (first > 12 && first <= 31) dayFirst = true;
    if (second > 12 && second <= 31) monthFirst = true;
  }

  if (dayFirst && monthFirst) return "conflict";
  if (dayFirst) return "day-first";
  if (monthFirst) return "month-first";
  return "none";
}

/**
 * The parser that reads the same value shape in the opposite order, if the
 * set holds one — how `us` and `eu-slash` relate.
 */
function oppositeOrderParser(parser: DateParser): DateParser | null {
  const order = dayMonthOrderOfFormat(parser.format);
  if (!order) return null;

  return (
    DATE_PARSERS.find(
      (candidate) =>
        candidate.id !== parser.id &&
        candidate.pattern.source === parser.pattern.source &&
        dayMonthOrderOfFormat(candidate.format) !== null &&
        dayMonthOrderOfFormat(candidate.format) !== order
    ) ?? null
  );
}

/** How many of the values a parser reads as a plausible date. */
function scoreParser(parser: DateParser, values: string[]): number {
  let score = 0;

  for (const value of values) {
    const trimmed = value.trim();
    if (!parser.pattern.test(trimmed)) continue;

    const parsed = parse(trimmed, parser.format, new Date());
    if (!isValid(parsed)) continue;

    const year = parsed.getFullYear();
    if (year >= 1990 && year <= 2100) score++;
  }

  return score;
}

/**
 * Auto-detect the date format from sample values.
 * Returns the parser ID that successfully parses the most samples.
 *
 * Parsers that differ only in day/month order score identically on a column
 * whose days all sit at 12 or lower, and picking one by array position writes
 * swapped dates with no error and a plausible-looking preview. Such a tie is
 * resolved from the column's own evidence, and left unresolved — null, so the
 * user picks from the dropdown — when the column proves nothing.
 */
export function detectDateFormat(samples: string[]): string | null {
  const validSamples = samples.filter((s) => s && s.trim().length > 0);
  if (validSamples.length === 0) return null;

  let bestScore = 0;
  let leaders: DateParser[] = [];

  for (const parser of DATE_PARSERS) {
    const score = scoreParser(parser, validSamples);
    if (score === 0) continue;

    if (score > bestScore) {
      bestScore = score;
      leaders = [parser];
    } else if (score === bestScore) {
      leaders.push(parser);
    }
  }

  // Require at least 50% match rate
  if (leaders.length === 0 || bestScore < validSamples.length * 0.5) return null;

  const ambiguous = leaders.filter((p) => dayMonthOrderOfFormat(p.format) !== null);
  const orders = new Set(ambiguous.map((p) => dayMonthOrderOfFormat(p.format)));

  if (orders.size > 1) {
    const evidence = analyzeDayMonthOrder(validSamples);
    if (evidence === "none" || evidence === "conflict") return null;

    const resolved = ambiguous.find((p) => dayMonthOrderOfFormat(p.format) === evidence);
    if (resolved) return resolved.id;
  }

  return leaders[0].id;
}

/**
 * Whether the values read as dates at all, independent of which parser wins.
 * A column whose day/month order cannot be settled is still a date column —
 * detection returns null for the format, not for the field (#70).
 */
export function looksLikeDateColumn(values: string[]): boolean {
  const validValues = values.filter((v) => v && v.trim().length > 0);
  if (validValues.length === 0) return false;

  return DATE_PARSERS.some(
    (parser) => scoreParser(parser, validValues) >= validValues.length * 0.5
  );
}

/**
 * Check a chosen parser against the evidence in a whole column, for the point
 * where every row is in hand rather than a 50-row analysis sample. Returns
 * null when the column agrees with the parser, cannot swap day and month, or
 * proves nothing — an explicit human choice is not second-guessed. A returned
 * conflict means importing would file dates under the wrong month.
 */
export function findDateColumnConflict(
  values: string[],
  parserId: string
): { evidence: DayMonthEvidence; expected: DayMonthOrder; suggestedParserId: string | null } | null {
  const parser = getDateParser(parserId);
  if (!parser) return null;

  const expected = dayMonthOrderOfFormat(parser.format);
  if (!expected) return null;

  const evidence = analyzeDayMonthOrder(values);
  if (evidence === "none" || evidence === expected) return null;

  return {
    evidence,
    expected,
    suggestedParserId: evidence === "conflict" ? null : oppositeOrderParser(parser)?.id ?? null,
  };
}

/**
 * Get parser by ID
 */
export function getDateParser(id: string): DateParser | undefined {
  return DATE_PARSERS.find((p) => p.id === id);
}

/**
 * Get parser name for display
 */
export function getDateParserName(id: string): string {
  const parser = getDateParser(id);
  return parser?.name ?? id;
}

/**
 * Validate a date string against a specific parser
 */
export function isValidDate(value: string, parserId: string): boolean {
  return parseDate(value, parserId) !== null;
}
