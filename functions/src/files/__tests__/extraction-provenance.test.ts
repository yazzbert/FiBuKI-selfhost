/**
 * #184: the marker a hand correction leaves behind, and the retro-stamp of the
 * corrections that were made before it existed. What matters here is that the
 * marker is per field and cumulative — a second correction must not erase the
 * first one's provenance — and that the retro-stamp resolves the checked-in
 * list without guessing.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    fromDate: (d: Date) => ({ _seconds: Math.floor(d.getTime() / 1000), toDate: () => d }),
    now: () => ({ _seconds: 1000 }),
  },
}));

import {
  buildCorrectionProvenance,
  correctedFieldsOf,
  hasHandCorrections,
} from "../extractionProvenanceOps";
import {
  KNOWN_HAND_CORRECTIONS,
  planKnownHandCorrectionStamps,
  type KnownCorrectionFileView,
} from "../knownHandCorrections";

const AT = { _seconds: 42 } as never;

describe("buildCorrectionProvenance", () => {
  it("stamps the fields the correction actually set, and nothing else", () => {
    const updates = buildCorrectionProvenance({}, ["vatPercent"], AT);

    expect(updates.extractionCorrectedFields).toEqual({ vatPercent: AT });
    expect(updates.extractionCorrectedAt).toBe(AT);
  });

  it("merges onto the marks earlier corrections left", () => {
    // paperless-ap-698: the total and the split were corrected first, the rate
    // later. The second correction must not make the first one invisible.
    const previous = { extractionCorrectedFields: { amount: AT, lineItems: AT } };
    const later = { _seconds: 99 } as never;

    const updates = buildCorrectionProvenance(previous, ["vatPercent"], later);

    expect(updates.extractionCorrectedFields).toEqual({
      amount: AT,
      lineItems: AT,
      vatPercent: later,
    });
    // The document-level stamp is the newest correction, not the first.
    expect(updates.extractionCorrectedAt).toBe(later);
  });

  it("re-stamps a field a later correction moved again", () => {
    const later = { _seconds: 99 } as never;
    const updates = buildCorrectionProvenance(
      { extractionCorrectedFields: { amount: AT } },
      ["amount"],
      later
    );

    expect(updates.extractionCorrectedFields).toEqual({ amount: later });
  });

  it("survives a record whose marker is missing or the wrong shape", () => {
    expect(buildCorrectionProvenance(undefined, ["date"], AT).extractionCorrectedFields).toEqual({
      date: AT,
    });
    expect(
      buildCorrectionProvenance({ extractionCorrectedFields: ["amount"] }, ["date"], AT)
        .extractionCorrectedFields
    ).toEqual({ date: AT });
  });
});

describe("correctedFieldsOf", () => {
  it("reads nothing off a record written before the marker existed", () => {
    expect(correctedFieldsOf({})).toEqual([]);
    expect(correctedFieldsOf(undefined)).toEqual([]);
    expect(hasHandCorrections({})).toBe(false);
  });

  it("names the fields in a stable order, whatever order they were written in", () => {
    const record = {
      extractionCorrectedFields: { lineItems: AT, amount: AT, vatPercent: AT },
    };

    expect(correctedFieldsOf(record)).toEqual(["amount", "vatPercent", "lineItems"]);
    expect(hasHandCorrections(record)).toBe(true);
  });

  it("keeps a key it does not recognise rather than dropping it", () => {
    // A field name from a future correction shape still means a person ruled
    // on something, and a refusal that hid it would be worse than a strange one.
    expect(
      correctedFieldsOf({ extractionCorrectedFields: { payableAmount: AT, amount: AT } })
    ).toEqual(["amount", "payableAmount"]);
  });
});

describe("planKnownHandCorrectionStamps", () => {
  const corpus: KnownCorrectionFileView[] = [
    { id: "yWekK2khosUuEmsWhCWD", fileName: "Dokument FIBU_20260109-8624.pdf" },
    { id: "jbXnvy8Hoea14lgIOJaG", fileName: "paperless-ap-698.pdf" },
    { id: "5s2aA53k3yEXy6lzTosd", fileName: "paperless-ap-714.pdf" },
    { id: "f-iv", fileName: "IV-26-1170.pdf" },
    { id: "f-oebb", fileName: "OEBBTicket.pdf" },
    { id: "f-ba", fileName: "Rechnung BA-Computer.pdf" },
    { id: "f-1182", fileName: "paperless-ap-1182.pdf" },
  ];

  it("resolves every one of the seven, by id where one is known", () => {
    const rows = planKnownHandCorrectionStamps(corpus);

    expect(rows).toHaveLength(KNOWN_HAND_CORRECTIONS.length);
    expect(rows.every((row) => row.action === "stamp")).toBe(true);
    expect(rows.filter((row) => row.matchedBy === "id").map((row) => row.fileId)).toEqual([
      "yWekK2khosUuEmsWhCWD",
      "jbXnvy8Hoea14lgIOJaG",
      "5s2aA53k3yEXy6lzTosd",
    ]);
  });

  it("carries the fields each correction actually set", () => {
    const rows = planKnownHandCorrectionStamps(corpus);
    const fields = (document: string) => rows.find((row) => row.document === document)?.fields;

    // The WKO levy: a not-claimable ruling on the rate, nothing else.
    expect(fields("paperless-ap-714")).toEqual(["vatPercent"]);
    // The Jungunternehmer rebate: total plus itemisation.
    expect(fields("Dokument FIBU_20260109-8624")).toEqual(["amount", "lineItems"]);
    expect(fields("paperless-ap-698")).toEqual(["amount", "vatAmount", "lineItems"]);
    expect(fields("IV-26-1170")).toEqual(["amount", "vatAmount"]);
  });

  it("is a no-op on a second run", () => {
    const stamped = corpus.map((file) => ({
      ...file,
      extractionCorrectedFields: Object.fromEntries(
        (KNOWN_HAND_CORRECTIONS.find(
          (entry) =>
            entry.fileId === file.id ||
            String(file.fileName).toLowerCase().includes(entry.fileNameContains.toLowerCase())
        )?.fields ?? []).map((field) => [field, AT])
      ),
    }));

    const rows = planKnownHandCorrectionStamps(stamped);

    expect(rows.every((row) => row.action === "already-stamped")).toBe(true);
    expect(rows.every((row) => row.fields.length === 0)).toBe(true);
  });

  it("adds only the fields a partially stamped file is missing", () => {
    const rows = planKnownHandCorrectionStamps([
      { id: "jbXnvy8Hoea14lgIOJaG", extractionCorrectedFields: { amount: AT } },
    ]);
    const row = rows.find((r) => r.document === "paperless-ap-698");

    expect(row).toMatchObject({ action: "stamp", fields: ["vatAmount", "lineItems"] });
  });

  it("reports a name matching two files instead of picking one", () => {
    const rows = planKnownHandCorrectionStamps([
      { id: "f-a", fileName: "OEBBTicket.pdf" },
      { id: "f-b", fileName: "OEBBTicket (1).pdf" },
    ]);
    const row = rows.find((r) => r.document === "OEBBTicket");

    expect(row).toMatchObject({ action: "ambiguous", fileId: null, fields: [] });
    expect(row?.candidates).toEqual(["f-a", "f-b"]);
  });

  it("reports a document the corpus does not hold", () => {
    const rows = planKnownHandCorrectionStamps([]);

    expect(rows.every((row) => row.action === "not-found")).toBe(true);
    expect(rows.every((row) => row.fileId === null)).toBe(true);
  });
});
