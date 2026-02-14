/**
 * Tests for pattern coverage validation and the FREE NOW space-variant bug.
 *
 * Covers:
 * 1. matchPatternFlexible gap: *freenow* vs "FREE NOW" (space matters)
 * 2. Coverage detection: finding assigned txs not matched by any pattern
 * 3. reference field inclusion in pattern matching
 */

import { describe, it, expect } from "vitest";
import { matchPatternFlexible, globMatch } from "../../utils/pattern-utils";

// ============================================================================
// 1. The FREE NOW bug: space in pattern matching
// ============================================================================

describe("FREE NOW pattern matching gap", () => {
  // The actual bug: Gemini generated *freenow* but "FREE NOW" has a space
  it("*freenow* does NOT match 'FREE NOW' (with space) — the bug", () => {
    // partner field: "FREE NOW", name field: "Card Payment"
    const matches = matchPatternFlexible("*freenow*", "Card Payment", "FREE NOW", null);
    expect(matches).toBe(false);
  });

  it("*freenow* DOES match 'FREENOW* BRATISLAVA' (no space)", () => {
    const matches = matchPatternFlexible("*freenow*", "FREENOW* BRATISLAVA", null, null);
    expect(matches).toBe(true);
  });

  it("*free*now* matches BOTH variants", () => {
    // With space (Revolut)
    expect(matchPatternFlexible("*free*now*", "Card Payment", "FREE NOW", null)).toBe(true);
    // Without space (other bank)
    expect(matchPatternFlexible("*free*now*", "FREENOW* BRATISLAVA", null, null)).toBe(true);
  });

  it("*free*now* matches 'free now' in the partner field individually", () => {
    expect(globMatch("*free*now*", "free now")).toBe(true);
    expect(globMatch("*free*now*", "freenow")).toBe(true);
    expect(globMatch("*free*now*", "freenow* bratislava")).toBe(true);
  });

  it("*freenow* does NOT match when FREE NOW is only in partner field", () => {
    // This is the exact Revolut scenario
    expect(matchPatternFlexible("*freenow*", "Card Payment", "FREE NOW", null)).toBe(false);

    // Even combined fields don't help: "card payment free now" doesn't contain "freenow"
    expect(globMatch("*freenow*", "card payment free now")).toBe(false);
    expect(globMatch("*freenow*", "free now card payment")).toBe(false);
  });
});

// ============================================================================
// 2. Coverage detection: finding uncovered assigned transactions
// ============================================================================

describe("coverage detection for assigned transactions", () => {
  // Simulate the coverage check from learnPartnerPatterns.ts
  function findUncoveredTransactions(
    patterns: Array<{ pattern: string }>,
    assignedTxs: Array<{ name: string; partner: string | null; reference: string | null }>
  ): typeof assignedTxs {
    return assignedTxs.filter(
      (tx) =>
        !patterns.some((p) =>
          matchPatternFlexible(p.pattern, tx.name || null, tx.partner, tx.reference)
        )
    );
  }

  it("detects uncovered FREE NOW transactions when only *freenow* pattern exists", () => {
    const patterns = [{ pattern: "*freenow*" }];
    const assignedTxs = [
      { name: "FREENOW* BRATISLAVA", partner: null, reference: null },          // covered
      { name: "Card Payment", partner: "FREE NOW", reference: null },            // NOT covered
      { name: "Card Payment", partner: "FREE NOW", reference: null },            // NOT covered
    ];

    const uncovered = findUncoveredTransactions(patterns, assignedTxs);
    expect(uncovered).toHaveLength(2);
    expect(uncovered[0].partner).toBe("FREE NOW");
  });

  it("all transactions covered when *free*now* pattern is added", () => {
    const patterns = [
      { pattern: "*freenow*" },
      { pattern: "*free*now*" },
    ];
    const assignedTxs = [
      { name: "FREENOW* BRATISLAVA", partner: null, reference: null },
      { name: "Card Payment", partner: "FREE NOW", reference: null },
      { name: "Card Payment", partner: "FREE NOW", reference: null },
    ];

    const uncovered = findUncoveredTransactions(patterns, assignedTxs);
    expect(uncovered).toHaveLength(0);
  });

  it("detects gap when identifier is only in reference field", () => {
    const patterns = [{ pattern: "*amazon*" }];
    const assignedTxs = [
      { name: "Amazon.de", partner: null, reference: null },                     // covered
      { name: "Lastschrift", partner: null, reference: "AMAZON EU SARL" },       // covered
      { name: "Kartenzahlung", partner: null, reference: null },                 // NOT covered
    ];

    const uncovered = findUncoveredTransactions(patterns, assignedTxs);
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].name).toBe("Kartenzahlung");
  });
});

// ============================================================================
// 3. reference field in pattern matching
// ============================================================================

describe("reference field included in pattern matching", () => {
  it("matches pattern against reference field individually", () => {
    expect(matchPatternFlexible("*free now*", "Kartenzahlung", null, "FREE NOW 12345")).toBe(true);
  });

  it("matches pattern against combined name + reference", () => {
    // allFields = "kartenzahlung free now 12345"
    expect(matchPatternFlexible("*kartenzahlung*free*now*", "Kartenzahlung", null, "FREE NOW 12345")).toBe(true);
  });

  it("does not match when identifier is absent from all fields", () => {
    expect(matchPatternFlexible("*netflix*", "Kartenzahlung", null, "REF-12345")).toBe(false);
  });
});

// ============================================================================
// 4. Similar real-world space/variant issues
// ============================================================================

describe("other space-variant pattern issues", () => {
  it("*media*markt* matches both 'Media Markt' and 'Mediamarkt'", () => {
    expect(matchPatternFlexible("*media*markt*", "Media Markt 1070 Wien", null, null)).toBe(true);
    expect(matchPatternFlexible("*media*markt*", "MEDIAMARKT ONLINE", null, null)).toBe(true);
  });

  it("*mediamarkt* does NOT match 'Media Markt' (same bug pattern)", () => {
    expect(matchPatternFlexible("*mediamarkt*", "Media Markt 1070 Wien", null, null)).toBe(false);
  });

  it("*post*ag* matches 'Post AG' and 'POSTAG'", () => {
    expect(matchPatternFlexible("*post*ag*", "Österreichische Post AG", null, null)).toBe(true);
    expect(matchPatternFlexible("*post*ag*", "POSTAG", null, null)).toBe(true);
  });
});
