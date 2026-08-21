/**
 * Tool Registry Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  store,
  createMockFirestore,
  createTestTransaction,
  createTestFile,
  createTestPartner,
  createTestSource,
} from "../../test/setup";

// Mock firebase-admin/firestore
vi.mock("firebase-admin/firestore", () => {
  // Minimal Timestamp stand-in. The mock in-memory store compares values via
  // toDate()/getTime(), so we only need fromDate/toDate/now.
  class MockTimestamp {
    constructor(private readonly date: Date) {}
    static fromDate(d: Date) {
      return new MockTimestamp(d);
    }
    static now() {
      return new MockTimestamp(new Date());
    }
    toDate() {
      return this.date;
    }
    valueOf() {
      return this.date.getTime();
    }
  }

  return {
    getFirestore: () => createMockFirestore(),
    FieldValue: {
      serverTimestamp: () => new Date(),
      arrayUnion: (...elements: unknown[]) => ({ elements, constructor: { name: "ArrayUnionTransform" } }),
      arrayRemove: (...elements: unknown[]) => ({ elements, constructor: { name: "ArrayRemoveTransform" } }),
      increment: (n: number) => n,
      delete: () => ({ constructor: { name: "DeleteTransform" } }),
    },
    Timestamp: MockTimestamp,
  };
});

// Import handlers after mocking
const handlers = await import("../handlers");

describe("Tool Registry Handlers", () => {
  const userId = "test-user-123";
  const otherUserId = "other-user-456";

  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Sources
  // ==========================================================================

  describe("listSources", () => {
    it("should return all active sources for user", async () => {
      store.setDoc("sources", "src-1", createTestSource({ userId, name: "Bank A", isActive: true }));
      store.setDoc("sources", "src-2", createTestSource({ userId, name: "Bank B", isActive: true }));
      store.setDoc("sources", "src-3", createTestSource({ userId, name: "Inactive", isActive: false }));
      store.setDoc("sources", "src-4", createTestSource({ userId: otherUserId, name: "Other User", isActive: true }));

      const result = await handlers.listSources(userId);

      expect(result).toHaveLength(2);
      expect(result.map((s: { name: string }) => s.name)).toContain("Bank A");
      expect(result.map((s: { name: string }) => s.name)).toContain("Bank B");
    });

    it("should return empty array when no sources exist", async () => {
      const result = await handlers.listSources(userId);
      expect(result).toEqual([]);
    });
  });

  describe("getSource", () => {
    it("should return source by ID", async () => {
      store.setDoc("sources", "src-1", createTestSource({ userId, name: "My Bank" }));

      const result = await handlers.getSource(userId, "src-1");

      expect(result.id).toBe("src-1");
      expect(result.name).toBe("My Bank");
    });

    it("should throw error for non-existent source", async () => {
      await expect(handlers.getSource(userId, "non-existent")).rejects.toThrow("Source not found");
    });

    it("should throw error for source owned by another user", async () => {
      store.setDoc("sources", "src-1", createTestSource({ userId: otherUserId }));

      await expect(handlers.getSource(userId, "src-1")).rejects.toThrow("Source not found");
    });

    it("should throw error when sourceId is missing", async () => {
      await expect(handlers.getSource(userId, "")).rejects.toThrow("sourceId is required");
    });
  });

  // ==========================================================================
  // Transactions
  // ==========================================================================

  describe("listTransactions", () => {
    it("should return transactions for user", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, name: "Purchase 1" }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, name: "Purchase 2" }));
      store.setDoc("transactions", "tx-3", createTestTransaction({ userId: otherUserId }));

      const result = await handlers.listTransactions(userId, {});

      expect(result.transactions).toHaveLength(2);
    });

    it("should filter by isComplete", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, isComplete: true }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, isComplete: false }));

      const complete = await handlers.listTransactions(userId, { isComplete: true });
      const incomplete = await handlers.listTransactions(userId, { isComplete: false });

      expect(complete.transactions).toHaveLength(1);
      expect(incomplete.transactions).toHaveLength(1);
    });

    it("should filter by sourceId", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, sourceId: "src-a" }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, sourceId: "src-b" }));

      const result = await handlers.listTransactions(userId, { sourceId: "src-a" });

      expect(result.transactions).toHaveLength(1);
    });

    it("should filter by search term", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, name: "Amazon Purchase" }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, name: "Netflix" }));

      const result = await handlers.listTransactions(userId, { search: "amazon" });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].name).toBe("Amazon Purchase");
    });

    it("should include formatted amount", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, amount: -2500, currency: "EUR" }));

      const result = await handlers.listTransactions(userId, {});

      expect(result.transactions[0].amountFormatted).toBe("-25.00 EUR");
    });
  });

  describe("getTransaction", () => {
    it("should return transaction by ID", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, name: "Test TX" }));

      const result = await handlers.getTransaction(userId, "tx-1");

      expect(result.id).toBe("tx-1");
      expect(result.name).toBe("Test TX");
    });

    it("should throw error for non-existent transaction", async () => {
      await expect(handlers.getTransaction(userId, "non-existent")).rejects.toThrow("Transaction not found");
    });

    it("should throw error for transaction owned by another user", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId: otherUserId }));

      await expect(handlers.getTransaction(userId, "tx-1")).rejects.toThrow("Transaction not found");
    });
  });

  describe("updateTransaction", () => {
    it("should update transaction description", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId }));

      const result = await handlers.updateTransaction(userId, {
        transactionId: "tx-1",
        description: "Updated description",
      });

      expect(result.success).toBe(true);
      const updated = store.getDoc("transactions", "tx-1");
      expect(updated?.description).toBe("Updated description");
    });

    it("should update isComplete status", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, isComplete: false }));

      await handlers.updateTransaction(userId, {
        transactionId: "tx-1",
        isComplete: true,
      });

      const updated = store.getDoc("transactions", "tx-1");
      expect(updated?.isComplete).toBe(true);
    });

    it("should throw error for non-existent transaction", async () => {
      await expect(
        handlers.updateTransaction(userId, { transactionId: "non-existent", description: "test" })
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("listTransactionsNeedingFiles", () => {
    it("should return transactions without files or categories", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: [], noReceiptCategoryId: null }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, fileIds: ["file-1"] }));
      store.setDoc("transactions", "tx-3", createTestTransaction({ userId, fileIds: [], noReceiptCategoryId: "cat-1" }));

      const result = await handlers.listTransactionsNeedingFiles(userId, {});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("tx-1");
    });

    it("should filter by minAmount", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, amount: -5000, fileIds: [] }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, amount: -500, fileIds: [] }));

      const result = await handlers.listTransactionsNeedingFiles(userId, { minAmount: 1000 });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("tx-1");
    });
  });

  // ==========================================================================
  // Files
  // ==========================================================================

  describe("listFiles", () => {
    it("should return files for user", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId }));
      store.setDoc("files", "f-2", createTestFile({ userId }));
      store.setDoc("files", "f-3", createTestFile({ userId: otherUserId }));

      const result = await handlers.listFiles(userId, {});

      expect(result).toHaveLength(2);
    });

    it("should exclude deleted files", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId }));
      store.setDoc("files", "f-2", createTestFile({ userId, deletedAt: new Date() }));

      const result = await handlers.listFiles(userId, {});

      expect(result).toHaveLength(1);
    });

    it("should filter by hasConnections", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, transactionIds: ["tx-1"] }));
      store.setDoc("files", "f-2", createTestFile({ userId, transactionIds: [] }));

      const connected = await handlers.listFiles(userId, { hasConnections: true });
      const unconnected = await handlers.listFiles(userId, { hasConnections: false });

      expect(connected).toHaveLength(1);
      expect(unconnected).toHaveLength(1);
    });
  });

  describe("getFile", () => {
    it("should return file by ID", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, fileName: "invoice.pdf" }));

      const result = await handlers.getFile(userId, "f-1");

      expect(result.id).toBe("f-1");
      expect(result.fileName).toBe("invoice.pdf");
    });

    it("should throw error for non-existent file", async () => {
      await expect(handlers.getFile(userId, "non-existent")).rejects.toThrow("File not found");
    });
  });

  describe("connectFileToTransaction", () => {
    it("should connect file to transaction", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, transactionIds: [] }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: [] }));

      const result = await handlers.connectFileToTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      expect(result.success).toBe(true);

      const file = store.getDoc("files", "f-1");
      const tx = store.getDoc("transactions", "tx-1");
      expect(file?.transactionIds).toContain("tx-1");
      expect(tx?.fileIds).toContain("f-1");
      expect(tx?.isComplete).toBe(true);
    });

    it("should create fileConnection record", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId }));

      await handlers.connectFileToTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      const connections = store.queryDocs("fileConnections", [{ field: "fileId", op: "==", value: "f-1" }]);
      expect(connections).toHaveLength(1);
      expect(connections[0].data.connectionType).toBe("api");
    });

    it("should throw error when file not found", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId }));

      await expect(
        handlers.connectFileToTransaction(userId, { fileId: "non-existent", transactionId: "tx-1" })
      ).rejects.toThrow("File not found");
    });

    it("should throw error when transaction not found", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId }));

      await expect(
        handlers.connectFileToTransaction(userId, { fileId: "f-1", transactionId: "non-existent" })
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("disconnectFileFromTransaction", () => {
    it("should disconnect file from transaction", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, transactionIds: ["tx-1"] }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: ["f-1"] }));
      store.setDoc("fileConnections", "conn-1", {
        fileId: "f-1",
        transactionId: "tx-1",
        userId,
      });

      const result = await handlers.disconnectFileFromTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      expect(result.success).toBe(true);
    });

    it("should throw error when connection not found", async () => {
      await expect(
        handlers.disconnectFileFromTransaction(userId, { fileId: "f-1", transactionId: "tx-1" })
      ).rejects.toThrow("Connection not found");
    });
  });

  // ==========================================================================
  // Categories
  // ==========================================================================

  describe("listNoReceiptCategories", () => {
    it("should return active categories for user", async () => {
      store.setDoc("noReceiptCategories", "cat-1", { userId, name: "Bank Fees", isActive: true });
      store.setDoc("noReceiptCategories", "cat-2", { userId, name: "Interest", isActive: true });
      store.setDoc("noReceiptCategories", "cat-3", { userId, name: "Inactive", isActive: false });

      const result = await handlers.listNoReceiptCategories(userId);

      expect(result).toHaveLength(2);
    });
  });

  describe("assignNoReceiptCategory", () => {
    it("should assign category to transaction", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, isComplete: false }));
      store.setDoc("noReceiptCategories", "cat-1", {
        userId,
        name: "Bank Fees",
        templateId: "template-1",
        isActive: true,
        transactionCount: 0,
      });

      const result = await handlers.assignNoReceiptCategory(userId, {
        transactionId: "tx-1",
        categoryId: "cat-1",
      });

      expect(result.success).toBe(true);
      expect(result.categoryName).toBe("Bank Fees");

      const tx = store.getDoc("transactions", "tx-1");
      expect(tx?.noReceiptCategoryId).toBe("cat-1");
      expect(tx?.isComplete).toBe(true);
    });

    it("should throw error for non-existent category", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId }));

      await expect(
        handlers.assignNoReceiptCategory(userId, { transactionId: "tx-1", categoryId: "non-existent" })
      ).rejects.toThrow("Category not found");
    });
  });

  describe("removeNoReceiptCategory", () => {
    it("should remove category from transaction", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        noReceiptCategoryId: "cat-1",
        isComplete: true,
        fileIds: [],
      }));
      store.setDoc("noReceiptCategories", "cat-1", {
        userId,
        name: "Bank Fees",
        transactionCount: 1,
      });

      const result = await handlers.removeNoReceiptCategory(userId, "tx-1");

      expect(result.success).toBe(true);
      expect(result.isComplete).toBe(false);

      const tx = store.getDoc("transactions", "tx-1");
      expect(tx?.noReceiptCategoryId).toBe(null);
    });

    it("should keep isComplete true if transaction has files", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        noReceiptCategoryId: "cat-1",
        isComplete: true,
        fileIds: ["f-1"],
      }));
      store.setDoc("noReceiptCategories", "cat-1", { userId, transactionCount: 1 });

      const result = await handlers.removeNoReceiptCategory(userId, "tx-1");

      expect(result.isComplete).toBe(true);
    });

    it("should throw error if no category assigned", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, noReceiptCategoryId: null }));

      await expect(handlers.removeNoReceiptCategory(userId, "tx-1")).rejects.toThrow(
        "Transaction has no category assigned"
      );
    });
  });

  // ==========================================================================
  // autoConnectFileSuggestions
  // ==========================================================================

  describe("autoConnectFileSuggestions", () => {
    it("should auto-connect files with high confidence suggestions", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: [],
        transactionMatchComplete: true,
        transactionSuggestions: [
          { transactionId: "tx-1", confidence: 95 },
          { transactionId: "tx-2", confidence: 70 },
        ],
      }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: [] }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, fileIds: [] }));

      const result = await handlers.autoConnectFileSuggestions(userId, { minConfidence: 89 });

      expect(result.connected).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0].transactionId).toBe("tx-1");
      expect(result.connections[0].confidence).toBe(95);
    });

    it("should skip files below confidence threshold", async () => {
      // When using fileId, it processes that specific file regardless of transactionMatchComplete
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: [],
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 50 }],
      }));

      const result = await handlers.autoConnectFileSuggestions(userId, { fileId: "f-1", minConfidence: 89 });

      expect(result.connected).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should skip already connected files", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: ["tx-existing"],
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 95 }],
      }));

      // Using fileId to target specific file
      const result = await handlers.autoConnectFileSuggestions(userId, { fileId: "f-1" });

      expect(result.connected).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should process specific file when fileId provided", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: [],
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 95 }],
      }));
      store.setDoc("files", "f-2", createTestFile({
        userId,
        transactionIds: [],
        transactionSuggestions: [{ transactionId: "tx-2", confidence: 95 }],
      }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId }));

      const result = await handlers.autoConnectFileSuggestions(userId, { fileId: "f-1" });

      expect(result.connected).toBe(1);
      expect(result.connections[0].fileId).toBe("f-1");
    });

    it("should throw error for non-existent fileId", async () => {
      await expect(
        handlers.autoConnectFileSuggestions(userId, { fileId: "non-existent" })
      ).rejects.toThrow("File not found");
    });

    it("should use default confidence of 89 when not specified", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: [],
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 88 }],
      }));

      // Using fileId to target specific file
      const result = await handlers.autoConnectFileSuggestions(userId, { fileId: "f-1" });

      expect(result.connected).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should connect to highest confidence suggestion", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: [],
        transactionMatchComplete: true,
        transactionSuggestions: [
          { transactionId: "tx-low", confidence: 90 },
          { transactionId: "tx-high", confidence: 98 },
          { transactionId: "tx-mid", confidence: 95 },
        ],
      }));
      store.setDoc("transactions", "tx-high", createTestTransaction({ userId }));

      const result = await handlers.autoConnectFileSuggestions(userId, {});

      expect(result.connections[0].transactionId).toBe("tx-high");
    });
  });

  // ==========================================================================
  // Edge Cases: Date Filtering
  // ==========================================================================

  describe("listTransactions - date filtering", () => {
    it("should filter by dateFrom", async () => {
      store.setDoc("transactions", "tx-old", createTestTransaction({
        userId,
        date: new Date("2024-01-01"),
      }));
      store.setDoc("transactions", "tx-new", createTestTransaction({
        userId,
        date: new Date("2024-06-15"),
      }));

      const result = await handlers.listTransactions(userId, { dateFrom: "2024-03-01" });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe("tx-new");
    });

    it("should filter by dateTo", async () => {
      store.setDoc("transactions", "tx-old", createTestTransaction({
        userId,
        date: new Date("2024-01-01"),
      }));
      store.setDoc("transactions", "tx-new", createTestTransaction({
        userId,
        date: new Date("2024-06-15"),
      }));

      const result = await handlers.listTransactions(userId, { dateTo: "2024-03-01" });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe("tx-old");
    });

    it("should filter by date range", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, date: new Date("2024-01-01") }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, date: new Date("2024-03-15") }));
      store.setDoc("transactions", "tx-3", createTestTransaction({ userId, date: new Date("2024-06-01") }));

      const result = await handlers.listTransactions(userId, {
        dateFrom: "2024-02-01",
        dateTo: "2024-05-01",
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe("tx-2");
    });
  });

  // ==========================================================================
  // Edge Cases: Limit Parameter
  // ==========================================================================

  describe("limit parameter", () => {
    // Note: Mock Firestore doesn't enforce limits, so we test that:
    // 1. The handler doesn't throw with limit param
    // 2. listTransactionsNeedingFiles applies limit client-side (after filter)

    it("listTransactions should accept limit parameter without error", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId }));

      const result = await handlers.listTransactions(userId, { limit: 3 });

      expect(result).toBeDefined();
      expect(Array.isArray(result.transactions)).toBe(true);
    });

    it("listTransactions should cap limit at 100", async () => {
      const result = await handlers.listTransactions(userId, { limit: 200 });
      // Just verify it doesn't throw - limit is applied server-side
      expect(result).toBeDefined();
      expect(Array.isArray(result.transactions)).toBe(true);
    });

    it("listFiles should accept limit parameter without error", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId }));

      const result = await handlers.listFiles(userId, { limit: 5 });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("listTransactionsNeedingFiles should apply limit after filtering", async () => {
      // This handler applies limit client-side after filtering, so we can test it
      for (let i = 0; i < 10; i++) {
        store.setDoc(`transactions`, `tx-${i}`, createTestTransaction({
          userId,
          fileIds: [],
          noReceiptCategoryId: null,
        }));
      }

      const result = await handlers.listTransactionsNeedingFiles(userId, { limit: 4 });

      expect(result).toHaveLength(4);
    });
  });

  // ==========================================================================
  // Edge Cases: Already Connected / Duplicate Operations
  // ==========================================================================

  describe("duplicate operations", () => {
    it("connectFileToTransaction should handle already connected file (adds duplicate)", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, transactionIds: ["tx-1"] }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: ["f-1"] }));

      // Should still succeed (creates another connection record)
      const result = await handlers.connectFileToTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      expect(result.success).toBe(true);
    });

    it("assignNoReceiptCategory should overwrite existing category", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        noReceiptCategoryId: "cat-old",
      }));
      store.setDoc("noReceiptCategories", "cat-old", { userId, transactionCount: 1 });
      store.setDoc("noReceiptCategories", "cat-new", {
        userId,
        name: "New Category",
        templateId: "t-1",
        transactionCount: 0,
      });

      const result = await handlers.assignNoReceiptCategory(userId, {
        transactionId: "tx-1",
        categoryId: "cat-new",
      });

      expect(result.success).toBe(true);
      const tx = store.getDoc("transactions", "tx-1");
      expect(tx?.noReceiptCategoryId).toBe("cat-new");
    });
  });

  // ==========================================================================
  // Edge Cases: Missing/Invalid Parameters
  // ==========================================================================

  describe("missing parameters", () => {
    it("connectFileToTransaction should throw when fileId missing", async () => {
      await expect(
        handlers.connectFileToTransaction(userId, { transactionId: "tx-1" } as any)
      ).rejects.toThrow("fileId and transactionId are required");
    });

    it("connectFileToTransaction should throw when transactionId missing", async () => {
      await expect(
        handlers.connectFileToTransaction(userId, { fileId: "f-1" } as any)
      ).rejects.toThrow("fileId and transactionId are required");
    });

    it("disconnectFileFromTransaction should throw when params missing", async () => {
      await expect(
        handlers.disconnectFileFromTransaction(userId, {} as any)
      ).rejects.toThrow("fileId and transactionId are required");
    });

    it("updateTransaction should throw when transactionId missing", async () => {
      await expect(
        handlers.updateTransaction(userId, { description: "test" } as any)
      ).rejects.toThrow("transactionId is required");
    });

    it("assignNoReceiptCategory should throw when params missing", async () => {
      await expect(
        handlers.assignNoReceiptCategory(userId, { transactionId: "tx-1" } as any)
      ).rejects.toThrow("transactionId and categoryId are required");
    });

    it("getTransaction should throw when transactionId empty", async () => {
      await expect(handlers.getTransaction(userId, "")).rejects.toThrow("transactionId is required");
    });

    it("getFile should throw when fileId empty", async () => {
      await expect(handlers.getFile(userId, "")).rejects.toThrow("fileId is required");
    });

    it("removeNoReceiptCategory should throw when transactionId empty", async () => {
      await expect(handlers.removeNoReceiptCategory(userId, "")).rejects.toThrow("transactionId is required");
    });
  });

  // ==========================================================================
  // Edge Cases: Search in Different Fields
  // ==========================================================================

  describe("listTransactions - search edge cases", () => {
    it("should search in description field", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        name: "Generic",
        description: "Office supplies from Amazon",
      }));

      const result = await handlers.listTransactions(userId, { search: "amazon" });

      expect(result.transactions).toHaveLength(1);
    });

    it("should search in partner field", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        name: "Generic",
        partner: "Amazon EU SARL",
      }));

      const result = await handlers.listTransactions(userId, { search: "amazon" });

      expect(result.transactions).toHaveLength(1);
    });

    it("should be case insensitive", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        name: "AMAZON PURCHASE",
      }));

      const result = await handlers.listTransactions(userId, { search: "amazon" });

      expect(result.transactions).toHaveLength(1);
    });

    it("should handle null fields gracefully", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        name: null,
        description: null,
        partner: null,
      }));

      // Should not throw, just return no matches
      const result = await handlers.listTransactions(userId, { search: "test" });

      expect(result.transactions).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Edge Cases: listFiles filters
  // ==========================================================================

  describe("listFiles - additional filters", () => {
    it("should filter by hasSuggestions true", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 90 }],
      }));
      store.setDoc("files", "f-2", createTestFile({
        userId,
        transactionSuggestions: [],
      }));

      const result = await handlers.listFiles(userId, { hasSuggestions: true });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-1");
    });

    it("should filter by hasSuggestions false", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 90 }],
      }));
      store.setDoc("files", "f-2", createTestFile({
        userId,
        transactionSuggestions: [],
      }));

      const result = await handlers.listFiles(userId, { hasSuggestions: false });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-2");
    });

    it("should exclude isNotInvoice files", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId }));
      store.setDoc("files", "f-2", createTestFile({ userId, isNotInvoice: true }));

      const result = await handlers.listFiles(userId, {});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-1");
    });

    it("should combine multiple filters", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: [],
        transactionSuggestions: [{ transactionId: "tx-1", confidence: 90 }],
      }));
      store.setDoc("files", "f-2", createTestFile({
        userId,
        transactionIds: ["tx-1"],
        transactionSuggestions: [{ transactionId: "tx-2", confidence: 80 }],
      }));
      store.setDoc("files", "f-3", createTestFile({
        userId,
        transactionIds: [],
        transactionSuggestions: [],
      }));

      const result = await handlers.listFiles(userId, {
        hasConnections: false,
        hasSuggestions: true,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-1");
    });
  });

  // ==========================================================================
  // Edge Cases: disconnectFileFromTransaction updates
  // ==========================================================================

  describe("disconnectFileFromTransaction - array updates", () => {
    it("should remove fileId from transaction", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, transactionIds: ["tx-1"] }));
      store.setDoc("transactions", "tx-1", createTestTransaction({
        userId,
        fileIds: ["f-1", "f-2"],
      }));
      store.setDoc("fileConnections", "conn-1", {
        fileId: "f-1",
        transactionId: "tx-1",
        userId,
      });

      await handlers.disconnectFileFromTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      const tx = store.getDoc("transactions", "tx-1");
      expect(tx?.fileIds).not.toContain("f-1");
      expect(tx?.fileIds).toContain("f-2");
    });

    it("should remove transactionId from file", async () => {
      store.setDoc("files", "f-1", createTestFile({
        userId,
        transactionIds: ["tx-1", "tx-2"],
      }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: ["f-1"] }));
      store.setDoc("fileConnections", "conn-1", {
        fileId: "f-1",
        transactionId: "tx-1",
        userId,
      });

      await handlers.disconnectFileFromTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      const file = store.getDoc("files", "f-1");
      expect(file?.transactionIds).not.toContain("tx-1");
      expect(file?.transactionIds).toContain("tx-2");
    });

    it("should delete the fileConnection record", async () => {
      store.setDoc("files", "f-1", createTestFile({ userId, transactionIds: ["tx-1"] }));
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, fileIds: ["f-1"] }));
      store.setDoc("fileConnections", "conn-1", {
        fileId: "f-1",
        transactionId: "tx-1",
        userId,
      });

      await handlers.disconnectFileFromTransaction(userId, {
        fileId: "f-1",
        transactionId: "tx-1",
      });

      const conn = store.getDoc("fileConnections", "conn-1");
      expect(conn).toBeUndefined();
    });
  });

  // ==========================================================================
  // Billing cycle
  // ==========================================================================

  describe("billing cycle over the MCP", () => {
    /** A learned cycle in the pre-split flat shape a partner may still carry. */
    function learnedCycle(overrides: Record<string, unknown> = {}) {
      return {
        frequencyDays: 30,
        frequencyConfidence: 80,
        typicalDayOfMonth: 5,
        dayVariance: 2,
        sampleSize: 6,
        learnedAt: new Date("2026-07-05"),
        updatedAt: new Date("2026-07-05"),
        ...overrides,
      };
    }

    function charge(overrides: Record<string, unknown> = {}) {
      return createTestTransaction({
        userId,
        partnerId: "partner-1",
        amount: -3825,
        currency: "EUR",
        ...overrides,
      });
    }

    describe("get_partner / list_partners", () => {
      it("returns the effective cycle plus both halves", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));

        const partner = await handlers.getPartner(userId, "partner-1") as {
          billingCycle: {
            effective: { source: string; frequencyDays: number; documentExpectation: string };
            learned: { sampleSize: number; learnedAt: string };
            declared: unknown;
            recurrences: Array<{ bandKey: string }>;
          };
        };

        expect(partner.billingCycle.effective).toMatchObject({
          source: "learned",
          frequencyDays: 30,
          documentExpectation: "invoice",
        });
        expect(partner.billingCycle.learned.sampleSize).toBe(6);
        expect(partner.billingCycle.learned.learnedAt).toBe("2026-07-05T00:00:00.000Z");
        expect(partner.billingCycle.declared).toBeNull();
        expect(partner.billingCycle.recurrences).toHaveLength(1);
      });

      it("returns null for a partner that does not bill on a schedule", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId, name: "Rewe" }));

        const partner = await handlers.getPartner(userId, "partner-1") as { billingCycle: unknown };
        const list = await handlers.listPartners(userId, {}) as Array<{ billingCycle: unknown }>;

        expect(partner.billingCycle).toBeNull();
        expect(list[0].billingCycle).toBeNull();
      });

      it("list_partners carries the cycle so no second call per partner is needed", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Notion",
          billingCycle: learnedCycle({ frequencyDays: 365 }),
        }));

        const list = await handlers.listPartners(userId, {}) as Array<{
          billingCycle: { effective: { frequencyDays: number } };
        }>;

        expect(list[0].billingCycle.effective.frequencyDays).toBe(365);
      });
    });

    describe("set_partner_billing_cycle", () => {
      it("declares a cycle on a partner with no history", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId, name: "Canva" }));

        const result = await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "monthly", typicalDayOfMonth: 12, documentExpectation: "invoice" },
        }) as { billingCycle: { effective: { source: string; frequencyDays: number; typicalDayOfMonth: number } } };

        expect(result.billingCycle.effective).toMatchObject({
          source: "declared",
          frequencyDays: 30,
          typicalDayOfMonth: 12,
        });

        const stored = store.getDoc("partners", "partner-1")!.billingCycle as Record<string, unknown>;
        expect(stored.frequencyDays).toBe(30);
        // A declaration is the user's word: certain, with no history behind it.
        expect(stored.frequencyConfidence).toBe(100);
      });

      it("lets the declared half win over the learned one and keeps it visible", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));

        const result = await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "weekly", documentExpectation: "invoice" },
        }) as {
          billingCycle: {
            effective: { source: string; frequencyDays: number };
            learned: { frequencyDays: number };
            declared: { cadence: string; declaredAt: string };
          };
        };

        expect(result.billingCycle.effective).toMatchObject({ source: "declared", frequencyDays: 7 });
        expect(result.billingCycle.learned.frequencyDays).toBe(30);
        expect(result.billingCycle.declared.cadence).toBe("weekly");
        expect(result.billingCycle.declared.declaredAt).toEqual(expect.any(String));
      });

      it("keeps a custom cadence's own frequency and an expected amount band", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId, name: "OpenAI" }));

        const result = await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: {
            cadence: "custom",
            frequencyDays: 14,
            expectedAmount: { min: 2000, max: 2000, currency: "usd" },
            documentExpectation: "invoice",
          },
        }) as {
          billingCycle: {
            effective: { frequencyDays: number; amountBand: { min: number; currency: string } };
            recurrences: Array<{ bandKey: string }>;
          };
        };

        expect(result.billingCycle.effective.frequencyDays).toBe(14);
        expect(result.billingCycle.effective.amountBand).toMatchObject({ min: 2000, currency: "USD" });
        expect(result.billingCycle.recurrences[0].bandKey).toBe("USD:2000-2000");
      });

      it("null clears the declared half and falls back to the learned one", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));
        await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "weekly", documentExpectation: "none" },
        });

        const cleared = await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: null,
        }) as {
          billingCycle: {
            effective: { source: string; frequencyDays: number; documentExpectation: string };
            declared: unknown;
          };
        };

        expect(cleared.billingCycle.declared).toBeNull();
        expect(cleared.billingCycle.effective).toMatchObject({
          source: "learned",
          frequencyDays: 30,
          documentExpectation: "invoice",
        });
      });

      it("null on a partner with no learned half drops the cycle entirely", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId, name: "Vidio" }));
        await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "monthly" },
        });

        const cleared = await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: null,
        }) as { billingCycle: unknown };

        expect(cleared.billingCycle).toBeNull();
        expect(store.getDoc("partners", "partner-1")!.billingCycle).toBeUndefined();
      });

      it("rejects a missing partner, a missing declared key and a bad cadence", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId }));
        store.setDoc("partners", "partner-2", createTestPartner({ userId: otherUserId }));

        await expect(handlers.setPartnerBillingCycle(userId, { declared: null }))
          .rejects.toThrow("partnerId is required");
        await expect(handlers.setPartnerBillingCycle(userId, { partnerId: "partner-2", declared: null }))
          .rejects.toThrow("Partner not found");
        await expect(handlers.setPartnerBillingCycle(userId, { partnerId: "partner-1" }))
          .rejects.toThrow("declared is required");
        await expect(handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "fortnightly" },
        })).rejects.toThrow("declared.cadence must be one of");
        await expect(handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "custom" },
        })).rejects.toThrow("declared.frequencyDays");
      });
    });

    describe("list_recurring_partners", () => {
      it("returns cycle, last charge, next expected window and coverage", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));
        store.setDoc("transactions", "tx-1", charge({ date: new Date("2026-05-05"), fileIds: ["file-1"] }));
        store.setDoc("transactions", "tx-2", charge({ date: new Date("2026-06-05"), noReceiptCategoryId: "cat-1" }));
        store.setDoc("transactions", "tx-3", charge({ date: new Date("2026-07-05") }));

        const result = await handlers.listRecurringPartners(userId, {
          dateFrom: "2026-01-01",
          dateTo: "2026-07-31",
        }) as {
          partners: Array<{
            partnerId: string;
            name: string;
            billingCycle: { effective: { frequencyDays: number } };
            lastCharge: { transactionId: string; date: string; amount: number; currency: string; amountEur: number };
            nextExpected: { expectedAt: string; from: string; to: string; varianceDays: number };
            coverage: { charges: number; withFile: number; withCategory: number; missing: number };
          }>;
          nextCursor: string | null;
          count: number;
          dateFrom: string;
          dateTo: string;
        };

        expect(result.count).toBe(1);
        const partner = result.partners[0];
        expect(partner.partnerId).toBe("partner-1");
        expect(partner.name).toBe("Anthropic");
        expect(partner.billingCycle.effective.frequencyDays).toBe(30);
        // Last charge seen, in the billed currency and in EUR.
        expect(partner.lastCharge).toMatchObject({
          transactionId: "tx-3",
          date: "2026-07-05",
          amount: 3825,
          currency: "EUR",
          amountEur: 3825,
        });
        // 2026-07-05 + 30 days, plus/minus the learned day variance.
        expect(partner.nextExpected).toMatchObject({
          expectedAt: "2026-08-04",
          from: "2026-08-02",
          to: "2026-08-06",
          varianceDays: 2,
        });
        expect(partner.coverage).toEqual({ charges: 3, withFile: 1, withCategory: 1, missing: 1 });
        expect(result.nextCursor).toBeNull();
        expect(result.dateFrom).toBe("2026-01-01");
        expect(result.dateTo).toBe("2026-07-31");
      });

      it("counts coverage only inside the date range", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));
        store.setDoc("transactions", "tx-1", charge({ date: new Date("2025-12-05") }));
        store.setDoc("transactions", "tx-2", charge({ date: new Date("2026-06-05") }));
        store.setDoc("transactions", "tx-3", charge({ date: new Date("2026-07-05") }));

        const result = await handlers.listRecurringPartners(userId, {
          dateFrom: "2026-06-01",
          dateTo: "2026-07-05",
        }) as { partners: Array<{ coverage: { charges: number }; lastCharge: { transactionId: string } }> };

        expect(result.partners[0].coverage.charges).toBe(2);
        // The last charge seen is the newest one, whatever the coverage range is.
        expect(result.partners[0].lastCharge.transactionId).toBe("tx-3");
      });

      it("reads the billed currency off the connected invoice", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "OpenAI",
          billingCycle: learnedCycle(),
        }));
        store.setDoc("files", "file-1", createTestFile({
          userId,
          extractedAmount: 2000,
          extractedCurrency: "USD",
        }));
        store.setDoc("transactions", "tx-1", charge({
          date: new Date("2026-07-05"),
          amount: -1847,
          fileIds: ["file-1"],
        }));

        const result = await handlers.listRecurringPartners(userId, {}) as {
          partners: Array<{ lastCharge: { amount: number; currency: string; amountEur: number; hasFile: boolean } }>;
        };

        expect(result.partners[0].lastCharge).toMatchObject({
          amount: 2000,
          currency: "USD",
          amountEur: 1847,
          hasFile: true,
        });
      });

      it("never reports a missing document for a partner expected to produce none", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId, name: "SVS" }));
        await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "quarterly", documentExpectation: "none" },
        });
        store.setDoc("transactions", "tx-1", charge({ date: new Date("2026-07-05") }));

        const result = await handlers.listRecurringPartners(userId, {
          dateFrom: "2026-01-01",
          dateTo: "2026-12-31",
        }) as { partners: Array<{ coverage: { charges: number; missing: number } }> };

        expect(result.partners[0].coverage).toMatchObject({ charges: 1, missing: 0 });
      });

      it("skips partners without a cycle and partners of another user", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));
        store.setDoc("partners", "partner-2", createTestPartner({ userId, name: "Rewe" }));
        store.setDoc("partners", "partner-3", createTestPartner({
          userId: otherUserId,
          name: "Netflix",
          billingCycle: learnedCycle(),
        }));

        const result = await handlers.listRecurringPartners(userId, {}) as {
          partners: Array<{ partnerId: string }>;
        };

        expect(result.partners.map((p) => p.partnerId)).toEqual(["partner-1"]);
      });

      it("pages with a cursor", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({
          userId,
          name: "Anthropic",
          billingCycle: learnedCycle(),
        }));
        store.setDoc("partners", "partner-2", createTestPartner({
          userId,
          name: "Notion",
          billingCycle: learnedCycle(),
        }));
        store.setDoc("partners", "partner-3", createTestPartner({
          userId,
          name: "Vidio",
          billingCycle: learnedCycle(),
        }));

        const first = await handlers.listRecurringPartners(userId, { limit: 2 }) as {
          partners: Array<{ name: string }>;
          nextCursor: string | null;
        };
        expect(first.partners.map((p) => p.name)).toEqual(["Anthropic", "Notion"]);
        expect(first.nextCursor).toBe("partner-2");

        const second = await handlers.listRecurringPartners(userId, {
          limit: 2,
          cursor: first.nextCursor!,
        }) as { partners: Array<{ name: string }>; nextCursor: string | null };
        expect(second.partners.map((p) => p.name)).toEqual(["Vidio"]);
        expect(second.nextCursor).toBeNull();
      });

      it("has no charge and no window for a declared partner with no history", async () => {
        store.setDoc("partners", "partner-1", createTestPartner({ userId, name: "Canva" }));
        await handlers.setPartnerBillingCycle(userId, {
          partnerId: "partner-1",
          declared: { cadence: "monthly" },
        });

        const result = await handlers.listRecurringPartners(userId, {}) as {
          partners: Array<{ lastCharge: unknown; nextExpected: unknown; coverage: { charges: number } }>;
        };

        expect(result.partners[0].lastCharge).toBeNull();
        expect(result.partners[0].nextExpected).toBeNull();
        expect(result.partners[0].coverage.charges).toBe(0);
      });
    });
  });

  // ==========================================================================
  // handleTool Dispatcher
  // ==========================================================================

  describe("handleTool", () => {
    it("should dispatch to correct handler", async () => {
      store.setDoc("sources", "src-1", createTestSource({ userId }));

      const result = await handlers.handleTool(userId, "list_sources", {});

      expect(result).toHaveLength(1);
    });

    it("should throw error for unknown tool", async () => {
      await expect(handlers.handleTool(userId, "unknown_tool", {})).rejects.toThrow("Unknown tool: unknown_tool");
    });

    it("should pass arguments to handler", async () => {
      store.setDoc("transactions", "tx-1", createTestTransaction({ userId, isComplete: true }));
      store.setDoc("transactions", "tx-2", createTestTransaction({ userId, isComplete: false }));

      const result = await handlers.handleTool(userId, "list_transactions", { isComplete: false }) as {
        transactions: unknown[];
      };

      expect(result.transactions).toHaveLength(1);
    });

    it("should handle all tool names", async () => {
      // Verify TOOL_NAMES matches actual handlers
      for (const toolName of handlers.TOOL_NAMES) {
        // Just verify it doesn't throw "Unknown tool"
        try {
          await handlers.handleTool(userId, toolName, {});
        } catch (e) {
          // Errors like "sourceId is required" are fine - means handler was called
          expect((e as Error).message).not.toContain("Unknown tool");
        }
      }
    });
  });
});
