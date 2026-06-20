/**
 * Tests for the EPC / Girocode QR payload builder.
 */

import { describe, it, expect } from "vitest";
import { buildEpcPayload } from "../epcPayload";

describe("buildEpcPayload", () => {
  it("builds a valid 11-line payload for AT IBAN", () => {
    const payload = buildEpcPayload({
      bic: "BKAUATWW",
      name: "Felix Häusler",
      iban: "AT12 1200 0000 1234 5678",
      amountCents: 12345,
      remittance: "Rechnung 2026-0001",
    });
    const lines = payload.split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("BCD");
    expect(lines[1]).toBe("002");
    expect(lines[2]).toBe("1");
    expect(lines[3]).toBe("SCT");
    expect(lines[4]).toBe("BKAUATWW");
    // Name: control chars (latin-1) preserved, IBAN spaces stripped, uppercased
    expect(lines[5]).toContain("Felix");
    expect(lines[6]).toBe("AT121200000012345678");
    expect(lines[6]).not.toContain(" ");
    expect(lines[7]).toBe("EUR123.45");
    expect(lines[8]).toBe(""); // purpose
    expect(lines[9]).toBe(""); // structured ref
    expect(lines[10]).toBe("Rechnung 2026-0001");
  });

  it("leaves BIC line empty when not supplied", () => {
    const payload = buildEpcPayload({
      name: "Test",
      iban: "AT111111111111111111",
      amountCents: 100,
    });
    const lines = payload.split("\n");
    expect(lines[4]).toBe("");
  });

  it("formats amount cents with leading zero in remainder", () => {
    const payload = buildEpcPayload({
      name: "Test",
      iban: "AT00000000000000000",
      amountCents: 1005,
    });
    const amountLine = payload.split("\n")[7];
    expect(amountLine).toBe("EUR10.05");
  });

  it("truncates beneficiary name to 70 chars", () => {
    const longName = "A".repeat(120);
    const payload = buildEpcPayload({
      name: longName,
      iban: "AT00000000000000000",
      amountCents: 100,
    });
    expect(payload.split("\n")[5].length).toBe(70);
  });

  it("truncates remittance info to 140 chars", () => {
    const longRem = "X".repeat(200);
    const payload = buildEpcPayload({
      name: "Test",
      iban: "AT00000000000000000",
      amountCents: 100,
      remittance: longRem,
    });
    expect(payload.split("\n")[10].length).toBe(140);
  });

  it("strips IBAN spaces and uppercases", () => {
    const payload = buildEpcPayload({
      name: "Test",
      iban: "  at12 3456 7890 1234 5678  ",
      amountCents: 100,
    });
    expect(payload.split("\n")[6]).toBe("AT123456789012345678");
  });
});
