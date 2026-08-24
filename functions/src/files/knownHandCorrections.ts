/**
 * The corrections that were made before the marker existed (#184).
 *
 * Seven files in the corpus carry a value a person set by hand, made through
 * the UI or through `update_file_extraction` while neither wrote provenance.
 * Nothing on those records says so, which is why the list had to be carried
 * from sweep to sweep by hand — the exact chore the marker exists to retire.
 * Shipping the marker without retro-stamping them would retire the chore for
 * every future correction and leave the seven that already happened depending
 * on the hand list for one more round.
 *
 * So the list is checked in ONCE, as data, and `stamp_known_hand_corrections`
 * turns it into markers. After that run the table is history: it is not a
 * registry to append to, because a correction made from here on stamps itself.
 *
 * Three ids were confirmed on 2026-08-21; the rest resolve by file name,
 * because the finance board names them and Firestore ids for them were never
 * written down. A name that matches more than one file is reported rather than
 * guessed — stamping the wrong document would tell a future sweep to preserve
 * a machine reading and skip a real correction.
 */

import type { CorrectableField } from "./extractionProvenanceOps";

export interface KnownHandCorrection {
  /** What the document is called on the finance board. */
  document: string;
  /** The Firestore file id, where it was confirmed. Matched first when present. */
  fileId?: string;
  /** Case-insensitive substring of `fileName`, the fallback identity. */
  fileNameContains: string;
  /** Which fields the person set. */
  fields: CorrectableField[];
  /** The correction itself, so a stamp made years later can still be audited. */
  correction: string;
}

export const KNOWN_HAND_CORRECTIONS: KnownHandCorrection[] = [
  {
    document: "Dokument FIBU_20260109-8624",
    fileId: "yWekK2khosUuEmsWhCWD",
    fileNameContains: "FIBU_20260109-8624",
    fields: ["amount", "lineItems"],
    correction: "total 0.00 plus the −272.00 Jungunternehmer rebate itemised",
  },
  {
    document: "paperless-ap-698",
    fileId: "jbXnvy8Hoea14lgIOJaG",
    fileNameContains: "paperless-ap-698",
    fields: ["amount", "vatAmount", "lineItems"],
    correction: "50.80 / 5.78 with the 10/20 split; two re-extractions have already failed on it",
  },
  {
    document: "paperless-ap-714",
    fileId: "5s2aA53k3yEXy6lzTosd",
    fileNameContains: "paperless-ap-714",
    fields: ["vatPercent"],
    correction: "vatPercent: 0 — the WKO levy's not-claimable ruling",
  },
  {
    document: "IV-26-1170",
    fileNameContains: "IV-26-1170",
    fields: ["amount", "vatAmount"],
    correction: "3180.00 / 530.00 — a Schlussrechnung whose items describe the full scope",
  },
  {
    document: "OEBBTicket",
    fileNameContains: "OEBBTicket",
    fields: ["amount"],
    correction: "73.80",
  },
  {
    document: "Rechnung BA-Computer",
    fileNameContains: "BA-Computer",
    fields: ["amount"],
    correction: "271.55",
  },
  {
    document: "paperless-ap-1182",
    fileNameContains: "paperless-ap-1182",
    fields: ["amount"],
    correction: "an invoice, not a credit note",
  },
];

/** The half of a file record the plan reads. */
export interface KnownCorrectionFileView {
  id: string;
  fileName?: unknown;
  extractionCorrectedFields?: unknown;
}

export type StampAction = "stamp" | "already-stamped" | "not-found" | "ambiguous";

export interface KnownCorrectionStampRow {
  document: string;
  correction: string;
  /** The file this row resolved to, or null when it did not resolve to exactly one. */
  fileId: string | null;
  matchedBy: "id" | "fileName" | null;
  action: StampAction;
  /** The fields this row would still add. Empty unless the action is `stamp`. */
  fields: string[];
  /** Every candidate, when the name matched more than one file. */
  candidates?: string[];
}

function correctedKeys(file: KnownCorrectionFileView): string[] {
  const raw = file.extractionCorrectedFields;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.keys(raw as Record<string, unknown>);
}

/**
 * Resolve the table against a corpus and say what each entry needs.
 *
 * Pure, and idempotent by construction: an entry whose fields are all stamped
 * already reports `already-stamped` and writes nothing, so a second run costs
 * nothing and a partially stamped file gains only the fields it is missing.
 * That matters because the run happens against live data with no dry-run
 * rehearsal possible — the corpus it targets exists in exactly one place.
 */
export function planKnownHandCorrectionStamps(
  files: KnownCorrectionFileView[],
  table: KnownHandCorrection[] = KNOWN_HAND_CORRECTIONS
): KnownCorrectionStampRow[] {
  return table.map((entry) => {
    const base = { document: entry.document, correction: entry.correction };

    const byId = entry.fileId ? files.find((file) => file.id === entry.fileId) : undefined;
    const needle = entry.fileNameContains.toLowerCase();
    const byName = files.filter(
      (file) => typeof file.fileName === "string" && file.fileName.toLowerCase().includes(needle)
    );

    // The id wins whenever it is present and resolves: it was confirmed against
    // the document itself, while a name is a heuristic over what the importer
    // happened to call the file.
    const match = byId ?? (byName.length === 1 ? byName[0] : undefined);

    if (!match) {
      return byName.length > 1
        ? {
            ...base,
            fileId: null,
            matchedBy: null,
            action: "ambiguous" as const,
            fields: [],
            candidates: byName.map((file) => file.id),
          }
        : { ...base, fileId: null, matchedBy: null, action: "not-found" as const, fields: [] };
    }

    const already = correctedKeys(match);
    const missing = entry.fields.filter((field) => !already.includes(field));

    return {
      ...base,
      fileId: match.id,
      matchedBy: byId ? ("id" as const) : ("fileName" as const),
      action: missing.length === 0 ? ("already-stamped" as const) : ("stamp" as const),
      fields: missing,
    };
  });
}
