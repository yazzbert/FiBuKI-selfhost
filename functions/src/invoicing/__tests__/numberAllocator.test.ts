/**
 * Tests for allocateInvoiceNumber.
 * Mocks Firestore transactions to verify atomicity and year-rollover behavior.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { allocateInvoiceNumber } from "../numberAllocator";

interface DocSnapshotMock {
  exists: boolean;
  data: () => { next?: number; year?: number } | undefined;
}

function buildMockDb(initial: { next?: number; year?: number } | null) {
  // Simulated stored state
  const state: { next?: number; year?: number } = initial ? { ...initial } : {};
  let exists = !!initial;

  const docRef = {
    set: vi.fn((data: { next?: number; year?: number }) => {
      state.next = data.next;
      state.year = data.year;
      exists = true;
    }),
  };

  const counterDoc = vi.fn(() => docRef);
  const settingsCollection = vi.fn(() => ({ doc: counterDoc }));
  const userDoc = vi.fn(() => ({ collection: settingsCollection }));
  const usersCollection = vi.fn(() => ({ doc: userDoc }));

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "users") return { doc: userDoc };
      throw new Error(`Unexpected collection: ${name}`);
    }),
    runTransaction: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: vi.fn(async (): Promise<DocSnapshotMock> => ({
          exists,
          data: () => (exists ? { next: state.next, year: state.year } : undefined),
        })),
        set: vi.fn((_ref: unknown, data: { next?: number; year?: number }) => {
          state.next = data.next;
          state.year = data.year;
          exists = true;
        }),
      };
      return fn(tx);
    }),
  };

  return { db, getState: () => ({ ...state, exists }), usersCollection, settingsCollection };
}

describe("allocateInvoiceNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts at 0001 when counter does not exist", async () => {
    const year = new Date().getFullYear();
    const { db, getState } = buildMockDb(null);

    const num = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    expect(num).toBe(`${year}-0001`);
    expect(getState().next).toBe(2);
    expect(getState().year).toBe(year);
  });

  it("increments existing counter for the same year", async () => {
    const year = new Date().getFullYear();
    const { db, getState } = buildMockDb({ next: 42, year });
    const num = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    expect(num).toBe(`${year}-0042`);
    expect(getState().next).toBe(43);
  });

  it("pads with leading zeros (4 digits)", async () => {
    const year = new Date().getFullYear();
    const { db } = buildMockDb({ next: 7, year });
    const num = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    expect(num).toBe(`${year}-0007`);
  });

  it("resets to 0001 when year changes", async () => {
    const year = new Date().getFullYear();
    const { db, getState } = buildMockDb({ next: 999, year: year - 1 });
    const num = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    expect(num).toBe(`${year}-0001`);
    expect(getState().year).toBe(year);
    expect(getState().next).toBe(2);
  });

  it("uses runTransaction (atomicity)", async () => {
    const { db } = buildMockDb(null);
    await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
  });

  it("sequential calls produce sequential numbers", async () => {
    const year = new Date().getFullYear();
    const { db } = buildMockDb(null);
    const a = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    const b = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    const c = await allocateInvoiceNumber(
      db as unknown as FirebaseFirestore.Firestore,
      "user-1",
    );
    expect(a).toBe(`${year}-0001`);
    expect(b).toBe(`${year}-0002`);
    expect(c).toBe(`${year}-0003`);
  });
});
