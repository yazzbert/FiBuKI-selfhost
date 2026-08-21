/**
 * Server-Side Tool Registry
 *
 * Single source of truth for all MCP/API tool handlers.
 * Used by:
 * - HTTP API (mcpApi) - external AI tools
 * - MCP SSE (mcpSse) - Anthropic Claude
 *
 * Note: Chat assistant (lib/agent/tools/) has its own implementation
 * for performance (direct Admin SDK reads). Writes are already unified
 * via Cloud Function callables.
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { buildDownloadUrl } from "../utils/buildDownloadUrl";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "./definitions";
import type { ToolName } from "./definitions";
import { PLANS } from "../billing/config";
import type { PlanId, PlanFeatures } from "../billing/config";
import {
  BILLING_CYCLE_CONFIG,
  bandKeyOf,
  bandsOverlap,
  cadenceToFrequencyDays,
  mergeBillingCycle,
  normalizeBillingCycle,
  toStoredBillingCycle,
} from "../matching/billingCycleDerivation";
import type {
  BillingAmountBand,
  BillingCadence,
  BillingDocumentExpectation,
  DeclaredBillingCycle,
  LearnedBillingCycle,
} from "../matching/billingCycleDerivation";
import { nextExpectedCharge, summarizeCoverage } from "../matching/billingCycleExpectations";

/**
 * Convert a Firestore Timestamp to YYYY-MM-DD in Europe/Vienna timezone.
 * Bank transactions are date-only — returning full ISO timestamps causes
 * timezone confusion (e.g. Dec 1 CET → Nov 30 UTC).
 */
function toLocalDate(ts: Timestamp | { toDate?: () => Date } | string | null | undefined): string | null {
  if (!ts) return null;
  if (typeof ts === "string") return ts;
  const date = typeof (ts as Timestamp).toDate === "function" ? (ts as Timestamp).toDate() : null;
  if (!date) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(date);
}

/** Any stored date — Timestamp, Date, ISO string or epoch millis — as a Date. */
function readDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof (value as Timestamp).toDate === "function") {
    const date = (value as Timestamp).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** A Date as YYYY-MM-DD in Europe/Vienna — same convention as `toLocalDate`. */
function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(date);
}

/** YYYY-MM-DD (Europe/Vienna) to a Date, as the transaction filters read it. */
function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(`${value}T00:00:00+01:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export { TOOL_NAMES };
export type { ToolName };

const db = getFirestore();

/**
 * Check if a tool requires a feature the user's plan doesn't have.
 * Returns an error message if blocked, or null if allowed.
 */
async function checkToolFeatureGate(userId: string, tool: string): Promise<string | null> {
  const toolDef = TOOL_DEFINITIONS.find((t) => t.name === tool);
  if (!toolDef?.requiredFeature) return null;

  const subDoc = await db.collection("subscriptions").doc(userId).get();
  const planId: PlanId = (subDoc.exists ? subDoc.data()!.plan : "free") || "free";
  const plan = PLANS[planId] || PLANS.free;

  if (!plan.planFeatures[toolDef.requiredFeature]) {
    return `Tool "${tool}" requires the "${toolDef.requiredFeature}" feature, which is not available on the ${plan.name} plan. Upgrade at https://fibuki.com/settings/billing`;
  }
  return null;
}

/**
 * Main tool dispatcher - routes tool calls to handlers
 */
export async function handleTool(
  userId: string,
  tool: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  // Check feature gate before executing
  const gateError = await checkToolFeatureGate(userId, tool);
  if (gateError) {
    throw new Error(gateError);
  }

  switch (tool) {
    // Sources
    case "list_sources":
      return listSources(userId);
    case "get_source":
      return getSource(userId, args.sourceId as string);
    case "create_source":
      return createSource(userId, args);
    case "delete_source":
      return deleteSource(userId, args);

    // Transactions
    case "list_transactions":
      return listTransactions(userId, args);
    case "get_transaction":
      return getTransaction(userId, args.transactionId as string);
    case "update_transaction":
      return updateTransaction(userId, args);
    case "list_transactions_needing_files":
      return listTransactionsNeedingFiles(userId, args);
    case "import_transactions":
      return importTransactions(userId, args);

    // Files
    case "list_files":
      return listFiles(userId, args);
    case "get_file":
      return getFile(userId, args.fileId as string);
    case "connect_file_to_transaction":
      return connectFileToTransaction(userId, args);
    case "disconnect_file_from_transaction":
      return disconnectFileFromTransaction(userId, args);
    case "auto_connect_file_suggestions":
      return autoConnectFileSuggestions(userId, args);
    case "upload_file":
      return uploadFile(userId, args);
    case "score_file_transaction_match":
      return scoreFileTransactionMatch(userId, args);

    // Identity entities (the user's personal/company entities used as invoice
    // sender). Returns id + name + vatId + ibans + address per entity.
    case "list_identity_entities":
      return listIdentityEntities(userId);
    case "update_identity_entity":
      return updateIdentityEntity(userId, args);

    // Partners
    case "list_partners":
      return listPartners(userId, args);
    case "get_partner":
      return getPartner(userId, args.partnerId as string);
    case "create_partner":
      return createPartner(userId, args);
    case "set_partner_billing_cycle":
      return setPartnerBillingCycle(userId, args);
    case "list_recurring_partners":
      return listRecurringPartners(userId, args);
    case "assign_partner_to_transaction":
      return assignPartnerToTx(userId, args);
    case "remove_partner_from_transaction":
      return removePartnerFromTx(userId, args);

    // Categories
    case "list_no_receipt_categories":
      return listNoReceiptCategories(userId);
    case "assign_no_receipt_category":
      return assignNoReceiptCategory(userId, args);
    case "remove_no_receipt_category":
      return removeNoReceiptCategory(userId, args.transactionId as string);

    // Invoicing
    case "create_invoice":
      return createInvoice(userId, args);
    case "update_invoice":
      return updateInvoice(userId, args);
    case "issue_invoice":
      return issueInvoice(userId, args);
    case "list_invoices":
      return listInvoices(userId, args);
    case "get_invoice":
      return getInvoice(userId, args);
    case "duplicate_invoice":
      return duplicateInvoice(userId, args);
    case "cancel_invoice":
      return cancelInvoice(userId, args);

    // Status
    case "get_automation_status":
      return getAutomationStatus(userId);

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

// ============================================================================
// Sources
// ============================================================================

export async function listSources(userId: string) {
  const snapshot = await db
    .collection("sources")
    .where("userId", "==", userId)
    .where("isActive", "==", true)
    .orderBy("name", "asc")
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function getSource(userId: string, sourceId: string) {
  if (!sourceId) throw new Error("sourceId is required");

  const doc = await db.collection("sources").doc(sourceId).get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error("Source not found");
  }
  return { id: doc.id, ...doc.data() };
}

// ============================================================================
// Transactions
// ============================================================================

export async function listTransactions(userId: string, args: Record<string, unknown>) {
  let query: FirebaseFirestore.Query = db
    .collection("transactions")
    .where("userId", "==", userId);

  if (args.sourceId) {
    query = query.where("sourceId", "==", args.sourceId);
  }
  if (args.isComplete !== undefined) {
    query = query.where("isComplete", "==", args.isComplete);
  }

  // Date range pushed into the query so filters apply BEFORE the limit.
  // Dates come in as YYYY-MM-DD (Europe/Vienna). Use local midnight for from,
  // next-day midnight for to (inclusive end-of-day).
  if (args.dateFrom) {
    const fromDate = new Date(`${args.dateFrom as string}T00:00:00+01:00`);
    if (!isNaN(fromDate.getTime())) {
      query = query.where("date", ">=", Timestamp.fromDate(fromDate));
    }
  }
  if (args.dateTo) {
    const toDate = new Date(`${args.dateTo as string}T00:00:00+01:00`);
    if (!isNaN(toDate.getTime())) {
      toDate.setDate(toDate.getDate() + 1);
      query = query.where("date", "<", Timestamp.fromDate(toDate));
    }
  }

  query = query.orderBy("date", "desc");

  // Cursor pagination: cursor is the last document id from the previous page.
  if (args.cursor) {
    const cursorSnap = await db.collection("transactions").doc(args.cursor as string).get();
    if (cursorSnap.exists && cursorSnap.data()?.userId === userId) {
      query = query.startAfter(cursorSnap);
    }
  }

  // Search is a substring match that Firestore can't push down. When set we
  // overfetch (up to 5x the requested limit) and filter in memory, capped to
  // avoid runaway scans. Callers that need stable pagination should avoid
  // combining `search` with `cursor`.
  const requestedLimit = Math.min(Math.max((args.limit as number) || 50, 1), 500);
  const search = (args.search as string | undefined)?.toLowerCase();
  const fetchLimit = search ? Math.min(requestedLimit * 5, 1000) : requestedLimit;
  query = query.limit(fetchLimit);

  const snapshot = await query.get();
  let transactions = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      date: toLocalDate(data.date) || data.date,
      amountFormatted: `${((data.amount || 0) / 100).toFixed(2)} ${data.currency || "EUR"}`,
    } as Record<string, unknown>;
  });

  if (search) {
    transactions = transactions.filter(
      (t) =>
        (t.name as string | undefined)?.toLowerCase().includes(search) ||
        (t.description as string | undefined)?.toLowerCase().includes(search) ||
        (t.partner as string | undefined)?.toLowerCase().includes(search)
    );
    transactions = transactions.slice(0, requestedLimit);
  }

  const hasMore = snapshot.docs.length === fetchLimit;
  const nextCursor = hasMore && transactions.length > 0
    ? (transactions[transactions.length - 1].id as string)
    : null;

  return { transactions, nextCursor, count: transactions.length };
}

export async function getTransaction(userId: string, transactionId: string) {
  if (!transactionId) throw new Error("transactionId is required");

  const doc = await db.collection("transactions").doc(transactionId).get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  const data = doc.data()!;
  return {
    id: doc.id,
    ...data,
    date: toLocalDate(data.date) || data.date,
    amountFormatted: `${((data.amount || 0) / 100).toFixed(2)} ${data.currency || "EUR"}`,
  };
}

export async function updateTransaction(userId: string, args: Record<string, unknown>) {
  const { transactionId, description, isComplete } = args;
  if (!transactionId) throw new Error("transactionId is required");

  const docRef = db.collection("transactions").doc(transactionId as string);
  const doc = await docRef.get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (description !== undefined) updates.description = description;
  if (isComplete !== undefined) updates.isComplete = isComplete;

  await docRef.update(updates);
  return { success: true, transactionId };
}

export async function listTransactionsNeedingFiles(userId: string, args: Record<string, unknown>) {
  let query = db.collection("transactions").where("userId", "==", userId).orderBy("date", "desc");

  const limit = Math.min((args.limit as number) || 50, 100);
  query = query.limit(500); // Fetch more to filter

  const snapshot = await query.get();
  let transactions = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return { id: doc.id, ...data, date: toLocalDate(data.date) || data.date } as Record<string, unknown>;
    })
    .filter(
      (t) =>
        (!(t.fileIds as string[]) || (t.fileIds as string[]).length === 0) && !t.noReceiptCategoryId && !t.quotaExceeded
    );

  if (args.minAmount !== undefined) {
    const minAmount = args.minAmount as number;
    transactions = transactions.filter((t) => Math.abs((t.amount as number) || 0) >= minAmount);
  }

  return transactions.slice(0, limit);
}

// ============================================================================
// Files
// ============================================================================

export async function listFiles(userId: string, args: Record<string, unknown>) {
  let query = db.collection("files").where("userId", "==", userId).orderBy("uploadedAt", "desc");

  const limit = Math.min((args.limit as number) || 50, 100);
  query = query.limit(limit);

  const snapshot = await query.get();
  let files = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((f: Record<string, unknown>) => !f.deletedAt && !f.isNotInvoice);

  if (args.hasConnections !== undefined) {
    files = files.filter((f: Record<string, unknown>) =>
      args.hasConnections
        ? ((f.transactionIds as string[])?.length || 0) > 0
        : ((f.transactionIds as string[])?.length || 0) === 0
    );
  }

  if (args.hasSuggestions !== undefined) {
    files = files.filter((f: Record<string, unknown>) =>
      args.hasSuggestions
        ? ((f.transactionSuggestions as unknown[])?.length || 0) > 0
        : ((f.transactionSuggestions as unknown[])?.length || 0) === 0
    );
  }

  return files;
}

export async function getFile(userId: string, fileId: string) {
  if (!fileId) throw new Error("fileId is required");

  const doc = await db.collection("files").doc(fileId).get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error("File not found");
  }
  return { id: doc.id, ...doc.data() };
}

export async function connectFileToTransaction(userId: string, args: Record<string, unknown>) {
  const { fileId, transactionId } = args;
  if (!fileId || !transactionId) {
    throw new Error("fileId and transactionId are required");
  }

  const [fileDoc, txDoc] = await Promise.all([
    db.collection("files").doc(fileId as string).get(),
    db.collection("transactions").doc(transactionId as string).get(),
  ]);

  if (!fileDoc.exists || fileDoc.data()?.userId !== userId) {
    throw new Error("File not found");
  }
  if (!txDoc.exists || txDoc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  if (txDoc.data()?.quotaExceeded) {
    throw new Error("Cannot connect files to over-quota transactions via API");
  }

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  const connRef = db.collection("fileConnections").doc();
  batch.set(connRef, {
    fileId,
    transactionId,
    userId,
    connectionType: "api",
    createdAt: now,
  });

  batch.update(fileDoc.ref, {
    transactionIds: FieldValue.arrayUnion(transactionId),
    updatedAt: now,
  });

  batch.update(txDoc.ref, {
    fileIds: FieldValue.arrayUnion(fileId),
    isComplete: true,
    updatedAt: now,
  });

  await batch.commit();
  return { success: true, fileId, transactionId };
}

export async function disconnectFileFromTransaction(userId: string, args: Record<string, unknown>) {
  const { fileId, transactionId } = args;
  if (!fileId || !transactionId) {
    throw new Error("fileId and transactionId are required");
  }

  const connSnapshot = await db
    .collection("fileConnections")
    .where("fileId", "==", fileId)
    .where("transactionId", "==", transactionId)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (connSnapshot.empty) {
    throw new Error("Connection not found");
  }

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  batch.delete(connSnapshot.docs[0].ref);

  batch.update(db.collection("files").doc(fileId as string), {
    transactionIds: FieldValue.arrayRemove(transactionId),
    updatedAt: now,
  });

  batch.update(db.collection("transactions").doc(transactionId as string), {
    fileIds: FieldValue.arrayRemove(fileId),
    updatedAt: now,
  });

  await batch.commit();
  return { success: true, fileId, transactionId };
}

export async function autoConnectFileSuggestions(userId: string, args: Record<string, unknown>) {
  const minConfidence = (args.minConfidence as number) || 89;
  const fileId = args.fileId as string | undefined;

  let files: Record<string, unknown>[];

  if (fileId) {
    const doc = await db.collection("files").doc(fileId).get();
    if (!doc.exists || doc.data()?.userId !== userId) {
      throw new Error("File not found");
    }
    files = [{ id: doc.id, ...doc.data() }];
  } else {
    const snapshot = await db
      .collection("files")
      .where("userId", "==", userId)
      .where("transactionMatchComplete", "==", true)
      .get();

    files = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(
        (f: Record<string, unknown>) =>
          !f.deletedAt &&
          !f.isNotInvoice &&
          (!(f.transactionIds as string[]) || (f.transactionIds as string[]).length === 0) &&
          (f.transactionSuggestions as Array<{ confidence: number }>)?.some(
            (s) => s.confidence >= minConfidence
          )
      );
  }

  const result = { connected: 0, skipped: 0, connections: [] as Record<string, unknown>[] };

  for (const file of files) {
    if ((file.transactionIds as string[])?.length > 0) {
      result.skipped++;
      continue;
    }

    const suggestions = file.transactionSuggestions as Array<{
      transactionId: string;
      confidence: number;
    }>;
    const bestSuggestion = suggestions
      ?.filter((s) => s.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (!bestSuggestion) {
      result.skipped++;
      continue;
    }

    try {
      await connectFileToTransaction(userId, {
        fileId: file.id,
        transactionId: bestSuggestion.transactionId,
      });
      result.connected++;
      result.connections.push({
        fileId: file.id,
        transactionId: bestSuggestion.transactionId,
        confidence: bestSuggestion.confidence,
      });
    } catch {
      result.skipped++;
    }
  }

  return result;
}

// ============================================================================
// Categories
// ============================================================================

export async function listNoReceiptCategories(userId: string) {
  const snapshot = await db
    .collection("noReceiptCategories")
    .where("userId", "==", userId)
    .where("isActive", "==", true)
    .orderBy("name", "asc")
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function assignNoReceiptCategory(userId: string, args: Record<string, unknown>) {
  const { transactionId, categoryId } = args;
  if (!transactionId || !categoryId) {
    throw new Error("transactionId and categoryId are required");
  }

  const [txDoc, catDoc] = await Promise.all([
    db.collection("transactions").doc(transactionId as string).get(),
    db.collection("noReceiptCategories").doc(categoryId as string).get(),
  ]);

  if (!txDoc.exists || txDoc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }
  if (!catDoc.exists || catDoc.data()?.userId !== userId) {
    throw new Error("Category not found");
  }

  const catData = catDoc.data()!;
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  batch.update(txDoc.ref, {
    noReceiptCategoryId: categoryId,
    noReceiptCategoryTemplateId: catData.templateId,
    noReceiptCategoryMatchedBy: "api",
    isComplete: true,
    updatedAt: now,
  });

  batch.update(catDoc.ref, {
    transactionCount: FieldValue.increment(1),
    updatedAt: now,
  });

  await batch.commit();
  return { success: true, transactionId, categoryId, categoryName: catData.name };
}

export async function removeNoReceiptCategory(userId: string, transactionId: string) {
  if (!transactionId) throw new Error("transactionId is required");

  const txDoc = await db.collection("transactions").doc(transactionId).get();
  if (!txDoc.exists || txDoc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  const txData = txDoc.data()!;
  const categoryId = txData.noReceiptCategoryId;
  if (!categoryId) {
    throw new Error("Transaction has no category assigned");
  }

  const hasFiles = txData.fileIds && txData.fileIds.length > 0;
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  batch.update(txDoc.ref, {
    noReceiptCategoryId: null,
    noReceiptCategoryTemplateId: null,
    noReceiptCategoryMatchedBy: null,
    isComplete: hasFiles,
    updatedAt: now,
  });

  batch.update(db.collection("noReceiptCategories").doc(categoryId), {
    transactionCount: FieldValue.increment(-1),
    updatedAt: now,
  });

  await batch.commit();
  return { success: true, transactionId, isComplete: hasFiles };
}

// ============================================================================
// Partners
// ============================================================================

/**
 * List the user's identity entities (personalEntity + companies[]). These
 * are the parties an invoice can be issued FROM. Returned in a flat array
 * with `type: "person" | "company"` so MCP callers can pick an entityId
 * to pass as `issuerEntityId` in update_invoice.
 */
export async function listIdentityEntities(userId: string) {
  const snap = await db.doc(`users/${userId}/settings/userData`).get();
  if (!snap.exists) return { entities: [] };
  const data = snap.data() || {};
  const entities: Array<Record<string, unknown>> = [];
  if (data.personalEntity && data.personalEntity.id) {
    entities.push({ ...data.personalEntity, type: "person" });
  }
  if (Array.isArray(data.companies)) {
    for (const c of data.companies) {
      if (c && c.id) entities.push({ ...c, type: "company" });
    }
  }
  return { entities };
}

/**
 * Patch an existing identity entity (personalEntity or one of companies[]).
 * Accepts a sparse patch of name / vatId / ibans / address. Used by MCP
 * agents to bring a company entity up to invoice-ready state (IBAN, VAT,
 * address) without forcing the user into the settings UI.
 */
export async function updateIdentityEntity(
  userId: string,
  args: Record<string, unknown>,
) {
  const entityId = String(args.entityId || "");
  if (!entityId) throw new Error("entityId is required");
  const patch = (args.patch as Record<string, unknown>) || {};

  const docRef = db.doc(`users/${userId}/settings/userData`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new Error("User data not found");
    const data = snap.data() as Record<string, unknown>;

    const applyPatch = (entity: Record<string, unknown>) => {
      const next: Record<string, unknown> = { ...entity };
      if (typeof patch.name === "string") next.name = patch.name.trim();
      if (typeof patch.vatId === "string") {
        const v = patch.vatId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (v) next.vatId = v; else delete next.vatId;
      }
      if (Array.isArray(patch.ibans)) {
        next.ibans = (patch.ibans as unknown[])
          .map((i) => String(i).trim().toUpperCase().replace(/\s+/g, ""))
          .filter(Boolean);
      }
      if (Array.isArray(patch.aliases)) {
        next.aliases = (patch.aliases as unknown[])
          .map((a) => String(a).trim())
          .filter(Boolean);
      }
      if (patch.address !== undefined) {
        const addr = (patch.address as Record<string, string> | null) || null;
        if (addr) {
          const clean: Record<string, string> = {};
          if (addr.street?.trim()) clean.street = addr.street.trim();
          if (addr.postalCode?.trim()) clean.postalCode = addr.postalCode.trim();
          if (addr.city?.trim()) clean.city = addr.city.trim();
          if (addr.country?.trim()) clean.country = addr.country.trim().toUpperCase();
          if (Object.keys(clean).length > 0) next.address = clean;
        } else {
          delete next.address;
        }
      }
      return next;
    };

    const personal = data.personalEntity as Record<string, unknown> | undefined;
    if (personal && personal.id === entityId) {
      data.personalEntity = applyPatch(personal);
    } else {
      const companies = (data.companies as Array<Record<string, unknown>>) || [];
      const idx = companies.findIndex((c) => c.id === entityId);
      if (idx < 0) throw new Error(`Identity entity ${entityId} not found`);
      companies[idx] = applyPatch(companies[idx]);
      data.companies = companies;
    }
    data.updatedAt = FieldValue.serverTimestamp();
    tx.set(docRef, data, { merge: true });
  });

  return { success: true, entityId };
}

export async function listPartners(userId: string, args: Record<string, unknown>) {
  const snapshot = await db
    .collection("partners")
    .where("userId", "==", userId)
    .where("isActive", "==", true)
    .orderBy("name", "asc")
    .get();

  let partners = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      aliases: data.aliases || [],
      vatId: data.vatId || null,
      ibans: data.ibans || [],
      website: data.website || null,
      country: data.country || null,
      defaultCategoryId: data.defaultCategoryId || null,
      billingCycle: toApiBillingCycle(data.billingCycle),
    };
  });

  if (args.search) {
    const search = (args.search as string).toLowerCase();
    partners = partners.filter(
      (p) =>
        p.name?.toLowerCase().includes(search) ||
        p.aliases?.some((a: string) => a.toLowerCase().includes(search))
    );
  }

  const limit = Math.min((args.limit as number) || 50, 100);
  return partners.slice(0, limit);
}

export async function getPartner(userId: string, partnerId: string) {
  if (!partnerId) throw new Error("partnerId is required");

  const doc = await db.collection("partners").doc(partnerId).get();
  if (!doc.exists || doc.data()?.userId !== userId) {
    throw new Error("Partner not found");
  }
  const data = doc.data()!;
  // The stored billingCycle still mirrors the primary recurrence's fields flat
  // onto its root for the readers written before the split; over the API it is
  // the resolved shape only.
  return { id: doc.id, ...data, billingCycle: toApiBillingCycle(data.billingCycle) };
}

export async function createPartner(userId: string, args: Record<string, unknown>) {
  const { createUserPartnerInternal } = await import("../partners/createUserPartner");
  return createUserPartnerInternal(db, userId, {
    name: args.name as string,
    aliases: args.aliases as string[] | undefined,
    vatId: args.vatId as string | undefined,
    ibans: args.ibans as string[] | undefined,
    website: args.website as string | undefined,
    country: args.country as string | undefined,
  });
}

// ---------------------------------------------------------------------------
// Billing cycle
// ---------------------------------------------------------------------------

/** Cadences and expectations a declaration may name. */
const BILLING_CADENCES: BillingCadence[] = ["weekly", "monthly", "quarterly", "yearly", "custom"];
const DOCUMENT_EXPECTATIONS: BillingDocumentExpectation[] = [
  "invoice",
  "no_receipt_category",
  "none",
];

/**
 * The billing cycle as the API returns it: the effective view plus the two
 * halves it was resolved from, and one entry per recurrence.
 *
 * Read through `normalizeBillingCycle`, so a partner still carrying the
 * pre-split flat shape reads as the one-band case. Instants become ISO strings
 * — a Timestamp does not survive JSON.
 */
export function toApiBillingCycle(raw: unknown): Record<string, unknown> | null {
  const structure = normalizeBillingCycle(raw);
  if (!structure) return null;

  return {
    effective: structure.effective ?? null,
    learned: structure.learned ? apiLearned(structure.learned) : null,
    declared: structure.declared ? apiDeclared(structure.declared) : null,
    recurrences: structure.recurrences.map((r) => ({
      bandKey: r.bandKey,
      effective: r.effective ?? null,
      learned: r.learned ? apiLearned(r.learned) : null,
      declared: r.declared ? apiDeclared(r.declared) : null,
    })),
  };
}

function apiLearned(learned: LearnedBillingCycle): Record<string, unknown> {
  return { ...learned, learnedAt: learned.learnedAt.toISOString() };
}

function apiDeclared(declared: DeclaredBillingCycle): Record<string, unknown> {
  return {
    ...declared,
    declaredAt: declared.declaredAt ? declared.declaredAt.toISOString() : null,
  };
}

/**
 * Declare, change or clear the declared half of a partner's billing cycle.
 *
 * `declared: null` clears every declaration on the partner and leaves what was
 * learned; the effective cycle falls back to the learned half. A declaration
 * replaces the one covering the same amount band and is folded in by
 * `mergeBillingCycle`, the same fold the learner uses — so a band with no
 * history of its own stays a recurrence in its own right (a vendor can be
 * declared recurring from day one).
 */
export async function setPartnerBillingCycle(userId: string, args: Record<string, unknown>) {
  const { partnerId } = args;
  if (!partnerId) throw new Error("partnerId is required");
  if (!("declared" in args)) {
    throw new Error("declared is required (pass null to clear the declared cycle)");
  }

  const partnerRef = db.collection("partners").doc(partnerId as string);
  const partnerSnap = await partnerRef.get();
  if (!partnerSnap.exists || partnerSnap.data()?.userId !== userId) {
    throw new Error("Partner not found");
  }

  const now = new Date();
  const declared = args.declared === null ? null : parseDeclaredCycle(args.declared, now);

  const existing = normalizeBillingCycle(partnerSnap.data()!.billingCycle);
  const learned = (existing?.recurrences ?? [])
    .map((r) => r.learned)
    .filter((l): l is LearnedBillingCycle => !!l);

  // Keep the declarations of the other bands; the new one replaces whatever
  // covered its band. Clearing drops all of them.
  const declarations = (existing?.recurrences ?? [])
    .map((r) => r.declared)
    .filter((d): d is DeclaredBillingCycle => !!d)
    .filter((d) => (declared ? !bandsOverlap(d.expectedAmount, declared.expectedAmount) : false));
  if (declared) declarations.push(declared);

  const merged = mergeBillingCycle(
    {
      recurrences: declarations.map((d) => ({
        bandKey: bandKeyOf(d.expectedAmount),
        declared: d,
      })),
    },
    learned
  );

  if (!merged) {
    // Nothing declared and nothing learned — the partner does not bill on a
    // schedule at all, so the field goes rather than lingering as an empty hull.
    await partnerRef.update({
      billingCycle: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, partnerId, billingCycle: null };
  }

  const billingCycle = toStoredBillingCycle(merged, (d) => Timestamp.fromDate(d), now);
  await partnerRef.update({ billingCycle, updatedAt: FieldValue.serverTimestamp() });

  return { success: true, partnerId, billingCycle: toApiBillingCycle(billingCycle) };
}

function parseDeclaredCycle(raw: unknown, now: Date): DeclaredBillingCycle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("declared must be an object or null");
  }
  const r = raw as Record<string, unknown>;

  const cadence = r.cadence as BillingCadence;
  if (!BILLING_CADENCES.includes(cadence)) {
    throw new Error(`declared.cadence must be one of: ${BILLING_CADENCES.join(", ")}`);
  }

  const frequencyDays = cadenceToFrequencyDays(
    cadence,
    typeof r.frequencyDays === "number" ? r.frequencyDays : undefined
  );
  if (!(frequencyDays > 0)) {
    throw new Error('declared.frequencyDays must be a positive number for cadence "custom"');
  }

  const expectation = (r.documentExpectation ?? "invoice") as BillingDocumentExpectation;
  if (!DOCUMENT_EXPECTATIONS.includes(expectation)) {
    throw new Error(
      `declared.documentExpectation must be one of: ${DOCUMENT_EXPECTATIONS.join(", ")}`
    );
  }

  let typicalDayOfMonth: number | undefined;
  if (r.typicalDayOfMonth !== undefined && r.typicalDayOfMonth !== null) {
    const day = r.typicalDayOfMonth;
    if (typeof day !== "number" || day < 1 || day > 31) {
      throw new Error("declared.typicalDayOfMonth must be between 1 and 31");
    }
    typicalDayOfMonth = Math.round(day);
  }

  return {
    cadence,
    frequencyDays,
    ...(typicalDayOfMonth !== undefined ? { typicalDayOfMonth } : {}),
    ...(r.expectedAmount !== undefined && r.expectedAmount !== null
      ? { expectedAmount: parseAmountBand(r.expectedAmount) }
      : {}),
    documentExpectation: expectation,
    declaredAt: now,
  };
}

function parseAmountBand(raw: unknown): BillingAmountBand {
  if (!raw || typeof raw !== "object") {
    throw new Error("declared.expectedAmount must be an object with min and max");
  }
  const r = raw as Record<string, unknown>;
  const min = r.min;
  const max = r.max;
  if (typeof min !== "number" || typeof max !== "number") {
    throw new Error("declared.expectedAmount.min and .max must be numbers (cents)");
  }
  if (min > max) {
    throw new Error("declared.expectedAmount.min must not be greater than max");
  }
  // Amounts are absolute here — the band describes what is billed, not how the
  // bank booked it.
  return {
    min: Math.abs(min),
    max: Math.abs(max),
    currency: typeof r.currency === "string" && r.currency ? r.currency.toUpperCase() : "EUR",
  };
}

/**
 * Every partner that bills on a schedule, with what a subscription view needs
 * per partner: the cycle, the last charge seen, the next expected window and
 * the document coverage of its charges in the date range.
 *
 * This response shape is a contract — the homelab subscription view renders
 * from it directly. Keep it stable.
 *
 * A partner is recurring when it has an effective cycle, declared or learned.
 * That lives in a nested field Firestore cannot filter on, so the partners are
 * read the way `list_partners` reads them and filtered here; only the page's
 * partners cost a transaction query.
 */
export async function listRecurringPartners(userId: string, args: Record<string, unknown>) {
  const dateTo = parseLocalDate(args.dateTo) ?? new Date();
  const dateFrom = parseLocalDate(args.dateFrom) ?? twelveMonthsBefore(dateTo);
  // dateTo is inclusive: charges up to the end of that day count.
  const rangeEnd = new Date(dateTo);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const snapshot = await db
    .collection("partners")
    .where("userId", "==", userId)
    .where("isActive", "==", true)
    .orderBy("name", "asc")
    .get();

  const recurring = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data(), cycle: normalizeBillingCycle(doc.data().billingCycle) }))
    .filter((p) => !!p.cycle?.effective)
    .sort(
      (a, b) =>
        String(a.data.name || "").localeCompare(String(b.data.name || "")) ||
        a.id.localeCompare(b.id)
    );

  // Cursor is the last partner id of the previous page. An unknown cursor
  // starts from the beginning, as it does in list_transactions.
  const cursor = args.cursor as string | undefined;
  const cursorIndex = cursor ? recurring.findIndex((p) => p.id === cursor) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const limit = Math.min(Math.max((args.limit as number) || 25, 1), 100);
  const page = recurring.slice(start, start + limit);

  const partners = [];
  for (const partner of page) {
    partners.push(
      await buildRecurringPartner(userId, partner.id, partner.data, partner.cycle!, dateFrom, rangeEnd)
    );
  }

  const nextCursor =
    start + limit < recurring.length && page.length > 0 ? page[page.length - 1].id : null;

  return {
    partners,
    nextCursor,
    count: partners.length,
    dateFrom: formatLocalDate(dateFrom),
    dateTo: formatLocalDate(dateTo),
  };
}

/** Default coverage range: the twelve months before the range end. */
function twelveMonthsBefore(date: Date): Date {
  const from = new Date(date);
  from.setFullYear(from.getFullYear() - 1);
  return from;
}

async function buildRecurringPartner(
  userId: string,
  partnerId: string,
  data: Record<string, unknown>,
  cycle: NonNullable<ReturnType<typeof normalizeBillingCycle>>,
  rangeStart: Date,
  rangeEnd: Date
) {
  // By partnerId only — never bankPartnerId, a card descriptor's partner is not
  // the supplier's charge.
  const txSnapshot = await db
    .collection("transactions")
    .where("userId", "==", userId)
    .where("partnerId", "==", partnerId)
    .orderBy("date", "desc")
    .limit(BILLING_CYCLE_CONFIG.MAX_TRANSACTIONS)
    .get();

  const charges = txSnapshot.docs
    .map((doc) => {
      const tx = doc.data();
      return {
        id: doc.id,
        date: readDate(tx.date),
        amount: typeof tx.amount === "number" ? tx.amount : 0,
        currency: typeof tx.currency === "string" ? tx.currency : "EUR",
        fileIds: Array.isArray(tx.fileIds) ? (tx.fileIds as string[]) : [],
        hasCategory: !!tx.noReceiptCategoryId,
      };
    })
    .filter((c) => !!c.date)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime());

  const effective = cycle.effective!;
  const last = charges[0] ?? null;
  const inRange = charges.filter(
    (c) => c.date!.getTime() >= rangeStart.getTime() && c.date!.getTime() < rangeEnd.getTime()
  );

  const expected = nextExpectedCharge(last?.date ?? null, effective);

  return {
    partnerId,
    name: data.name ?? null,
    billingCycle: toApiBillingCycle(data.billingCycle),
    lastCharge: last ? await buildLastCharge(last) : null,
    nextExpected: expected
      ? {
          expectedAt: formatLocalDate(expected.expectedAt),
          from: formatLocalDate(expected.from),
          to: formatLocalDate(expected.to),
          varianceDays: expected.varianceDays,
        }
      : null,
    coverage: summarizeCoverage(
      inRange.map((c) => ({ hasFile: c.fileIds.length > 0, hasCategory: c.hasCategory })),
      effective.documentExpectation
    ),
  };
}

interface ChargeRow {
  id: string;
  date: Date | null;
  amount: number;
  currency: string;
  fileIds: string[];
  hasCategory: boolean;
}

/**
 * The last charge, with its amount in the billed currency and in EUR, so a
 * run-rate can be computed without re-reading transactions.
 *
 * The bank books in the account's currency; what the vendor billed is on the
 * connected invoice (a 20.00 USD subscription is booked as a drifting EUR
 * amount). Both are absolute cents — a charge is a charge, whichever side of
 * the ledger it was booked on. `amountEur` is null when the account itself is
 * not in EUR, as no rate is stored to convert with.
 */
async function buildLastCharge(charge: ChargeRow) {
  let amount = Math.abs(charge.amount);
  let currency = charge.currency;

  // A charge carries one invoice in practice; the bound keeps a transaction
  // someone attached a folder to from costing a read per file.
  for (const fileId of charge.fileIds.slice(0, 5)) {
    const fileSnap = await db.collection("files").doc(fileId).get();
    const file = fileSnap.data();
    if (!file) continue;
    if (typeof file.extractedAmount === "number" && typeof file.extractedCurrency === "string") {
      amount = Math.abs(file.extractedAmount);
      currency = file.extractedCurrency;
      break;
    }
  }

  return {
    transactionId: charge.id,
    date: charge.date ? formatLocalDate(charge.date) : null,
    amount,
    currency,
    amountEur: charge.currency === "EUR" ? Math.abs(charge.amount) : null,
    hasFile: charge.fileIds.length > 0,
    hasCategory: charge.hasCategory,
  };
}

export async function assignPartnerToTx(userId: string, args: Record<string, unknown>) {
  const { transactionId, partnerId } = args;
  if (!transactionId) throw new Error("transactionId is required");
  if (!partnerId) throw new Error("partnerId is required");

  // Verify transaction ownership
  const txDoc = await db.collection("transactions").doc(transactionId as string).get();
  if (!txDoc.exists || txDoc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  // Verify partner ownership
  const partnerDoc = await db.collection("partners").doc(partnerId as string).get();
  if (!partnerDoc.exists || partnerDoc.data()?.userId !== userId) {
    throw new Error("Partner not found");
  }

  const now = FieldValue.serverTimestamp();
  await db.collection("transactions").doc(transactionId as string).update({
    partnerId,
    partnerType: "user",
    partnerMatchedBy: "api",
    partnerMatchConfidence: null,
    updatedAt: now,
    automationHistory: FieldValue.arrayUnion({
      type: "partner_assigned",
      ranAt: Timestamp.now(),
      status: "completed",
      actor: "manual",
      level: "decision",
      partnerName: partnerDoc.data()!.name || null,
      forPartnerId: partnerId,
      summary: `Partner "${partnerDoc.data()!.name}" assigned via API`,
    }),
  });

  return { success: true, transactionId, partnerId };
}

export async function removePartnerFromTx(userId: string, args: Record<string, unknown>) {
  const { transactionId } = args;
  if (!transactionId) throw new Error("transactionId is required");

  const txDoc = await db.collection("transactions").doc(transactionId as string).get();
  if (!txDoc.exists || txDoc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  const txData = txDoc.data()!;
  const previousPartnerId = txData.partnerId;

  // Look up partner name for activity log
  let partnerName: string | null = null;
  if (previousPartnerId) {
    try {
      const pSnap = await db.collection("partners").doc(previousPartnerId).get();
      partnerName = pSnap.data()?.name || null;
    } catch { /* best effort */ }
  }

  const now = FieldValue.serverTimestamp();
  await db.collection("transactions").doc(transactionId as string).update({
    partnerId: null,
    partnerType: null,
    partnerMatchedBy: null,
    partnerMatchConfidence: null,
    updatedAt: now,
    automationHistory: FieldValue.arrayUnion({
      type: "partner_removed",
      ranAt: Timestamp.now(),
      status: "completed",
      actor: "manual",
      level: "decision",
      partnerName: partnerName || previousPartnerId || null,
      forPartnerId: previousPartnerId || null,
      summary: `Partner "${partnerName || previousPartnerId}" removed via API`,
    }),
  });

  return { success: true, transactionId };
}

// ============================================================================
// Source Management
// ============================================================================

export async function createSource(userId: string, args: Record<string, unknown>) {
  const { createSourceInternal } = await import("../sources/createSource");
  return createSourceInternal(db, userId, {
    name: args.name as string,
    accountKind: (args.accountKind as "bank_account" | "credit_card") || "bank_account",
    iban: args.iban as string | undefined,
    currency: (args.currency as string) || "EUR",
    type: "manual",
  });
}

export async function deleteSource(userId: string, args: Record<string, unknown>) {
  const { sourceId, confirm } = args;
  if (!sourceId) throw new Error("sourceId is required");
  if (confirm !== true) {
    throw new Error("Must set confirm: true to delete a source. This will delete all associated transactions.");
  }

  const { deleteSourceInternal } = await import("../sources/deleteSource");
  return deleteSourceInternal(db, userId, sourceId as string);
}

// ============================================================================
// Import
// ============================================================================

export async function importTransactions(userId: string, args: Record<string, unknown>) {
  const { sourceId, transactions: rawTxs } = args;
  if (!sourceId) throw new Error("sourceId is required");
  if (!rawTxs || !Array.isArray(rawTxs)) throw new Error("transactions array is required");

  // Verify source ownership
  const sourceDoc = await db.collection("sources").doc(sourceId as string).get();
  if (!sourceDoc.exists || sourceDoc.data()?.userId !== userId) {
    throw new Error("Source not found");
  }

  // Build transaction data with dedupeHashes
  const crypto = await import("crypto");
  const importJobId = `api_${Date.now()}`;

  const transactions = (rawTxs as Array<Record<string, unknown>>).map((tx, index) => {
    const date = tx.date as string;
    const amount = tx.amount as number;
    const name = tx.name as string;
    const currency = (tx.currency as string) || "EUR";

    // Generate dedupeHash from key fields
    const hashInput = `${sourceId}|${date}|${amount}|${name}|${currency}`;
    const dedupeHash = crypto.createHash("sha256").update(hashInput).digest("hex");

    return {
      sourceId: sourceId as string,
      date,
      amount,
      currency,
      name,
      description: (tx.description as string) || null,
      partner: (tx.partner as string) || null,
      reference: (tx.reference as string) || null,
      partnerIban: (tx.partnerIban as string) || null,
      dedupeHash,
      importJobId,
      csvRowIndex: index,
      _original: {
        date: date,
        amount: String(amount),
        rawRow: tx as Record<string, string>,
      },
    };
  });

  // Use bulk create directly (not via callable to avoid double auth check)
  const { Timestamp: AdminTimestamp } = await import("firebase-admin/firestore");
  const { checkTransactionQuota, incrementTransactionCount } = await import("../billing/checkTransactionQuota");

  const quota = await checkTransactionQuota(userId, transactions.length, false);
  const overLimitStartIndex = quota.allowed ? transactions.length : quota.remainingSlots;

  const now = AdminTimestamp.now();
  const transactionIds: string[] = [];
  const overLimitTransactionIds: string[] = [];
  const BATCH_SIZE = 500;

  let globalIndex = 0;
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = transactions.slice(i, i + BATCH_SIZE);

    for (const txData of chunk) {
      const docRef = db.collection("transactions").doc();
      transactionIds.push(docRef.id);

      const isOverLimit = globalIndex >= overLimitStartIndex;
      if (isOverLimit) {
        overLimitTransactionIds.push(docRef.id);
      }

      const dateObj = new Date(txData.date);
      if (isNaN(dateObj.getTime())) {
        throw new Error(`Invalid date: ${txData.date}`);
      }

      const transactionDoc: Record<string, unknown> = {
        userId,
        sourceId: txData.sourceId,
        date: AdminTimestamp.fromDate(dateObj),
        amount: txData.amount,
        currency: txData.currency,
        name: txData.name,
        description: txData.description,
        partner: txData.partner,
        reference: txData.reference,
        partnerIban: txData.partnerIban,
        dedupeHash: txData.dedupeHash,
        importJobId: txData.importJobId,
        csvRowIndex: txData.csvRowIndex,
        _original: txData._original,
        fileIds: [],
        isComplete: false,
        partnerId: null,
        partnerType: null,
        partnerMatchConfidence: null,
        partnerMatchedBy: null,
        noReceiptCategoryId: null,
        createdAt: now,
        updatedAt: now,
      };

      if (isOverLimit) {
        transactionDoc.quotaExceeded = true;
      }

      batch.set(docRef, transactionDoc);
      globalIndex++;
    }

    await batch.commit();
  }

  const withinQuotaCount = transactionIds.length - overLimitTransactionIds.length;
  if (withinQuotaCount > 0) {
    incrementTransactionCount(userId, withinQuotaCount).catch((err) =>
      console.error("[importTransactions] Failed to increment transaction count:", err)
    );
  }

  return {
    success: true,
    transactionIds,
    count: transactionIds.length,
    quotaExceeded: overLimitTransactionIds.length > 0,
    overLimitCount: overLimitTransactionIds.length,
  };
}

// ============================================================================
// File Upload & Scoring
// ============================================================================

export async function uploadFile(userId: string, args: Record<string, unknown>) {
  const { url, base64, fileName, mimeType } = args;
  if (!fileName) throw new Error("fileName is required");
  if (!mimeType) throw new Error("mimeType is required");
  if (!url && !base64) throw new Error("Either url or base64 is required");

  let fileBuffer: Buffer;

  if (base64) {
    fileBuffer = Buffer.from(base64 as string, "base64");
  } else {
    // Download from URL
    const response = await fetch(url as string);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuffer);
  }

  // Upload to Storage with a Firebase download token (avoids signBlob IAM)
  const bucket = getStorage().bucket();
  const storagePath = `users/${userId}/files/${Date.now()}_${fileName}`;
  const file = bucket.file(storagePath);
  const downloadToken = randomUUID();

  await file.save(fileBuffer, {
    contentType: mimeType as string,
    metadata: {
      metadata: {
        userId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  const downloadUrl = buildDownloadUrl(bucket.name, storagePath, downloadToken);

  // Create file record in Firestore
  const now = FieldValue.serverTimestamp();
  const fileDoc = await db.collection("files").add({
    userId,
    fileName: fileName as string,
    mimeType: mimeType as string,
    storagePath,
    downloadUrl,
    fileSize: fileBuffer.length,
    transactionIds: [],
    isNotInvoice: false,
    extractionComplete: false,
    partnerMatchComplete: false,
    transactionMatchComplete: false,
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return {
    success: true,
    fileId: fileDoc.id,
    fileName,
    storagePath,
    fileSize: fileBuffer.length,
  };
}

export async function scoreFileTransactionMatch(userId: string, args: Record<string, unknown>) {
  const { fileId, transactionId } = args;
  if (!fileId) throw new Error("fileId is required");
  if (!transactionId) throw new Error("transactionId is required");

  // Verify ownership
  const [fileDoc, txDoc] = await Promise.all([
    db.collection("files").doc(fileId as string).get(),
    db.collection("transactions").doc(transactionId as string).get(),
  ]);

  if (!fileDoc.exists || fileDoc.data()?.userId !== userId) {
    throw new Error("File not found");
  }
  if (!txDoc.exists || txDoc.data()?.userId !== userId) {
    throw new Error("Transaction not found");
  }

  // Use the shared scoring logic
  const { scoreTransaction, formatScoreBreakdown } = await import("../matching/transactionScoring");

  const fileData = fileDoc.data()!;
  const txData = txDoc.data()!;

  const result = scoreTransaction(
    {
      extractedAmount: fileData.extractedAmount,
      extractedCurrency: fileData.extractedCurrency,
      extractedDate: fileData.extractedDate,
      extractedPartner: fileData.extractedPartner,
      extractedIban: fileData.extractedIban,
      extractedText: fileData.extractedText,
      partnerId: fileData.partnerId,
    },
    {
      id: transactionId as string,
      amount: txData.amount,
      date: txData.date,
      currency: txData.currency,
      name: txData.name,
      partner: txData.partner,
      partnerName: txData.partnerName,
      partnerId: txData.partnerId,
      partnerIban: txData.partnerIban,
      reference: txData.reference,
    },
    []
  );

  return {
    fileId,
    transactionId,
    confidence: result.confidence,
    matchSources: result.matchSources,
    breakdown: formatScoreBreakdown(result.breakdown),
  };
}

// ============================================================================
// Automation Status
// ============================================================================

/** Filter tools to those available for a given plan's features */
function getAvailableTools(features: PlanFeatures) {
  return TOOL_DEFINITIONS.filter((tool) => {
    if (!tool.requiredFeature) return true;
    return features[tool.requiredFeature];
  });
}

export async function getAutomationStatus(userId: string) {
  const subDoc = await db.collection("subscriptions").doc(userId).get();

  const planId: PlanId = (subDoc.exists ? subDoc.data()!.plan : "free") || "free";
  const plan = PLANS[planId] || PLANS.free;
  const features = plan.planFeatures;
  const availableTools = getAvailableTools(features);

  if (!subDoc.exists) {
    return {
      automationMode: "active",
      plan: "free",
      planFeatures: features,
      availableTools,
      rateLimit: plan.rateLimit,
      aiBudget: {
        fairUseLimitEur: 0.5,
        usageCurrentPeriodEur: 0,
        creditsEur: 0,
        paused: false,
      },
    };
  }

  const sub = subDoc.data()!;
  return {
    automationMode: sub.automationMode || "active",
    plan: sub.plan || "free",
    planFeatures: features,
    availableTools,
    rateLimit: plan.rateLimit,
    aiBudget: {
      fairUseLimitEur: sub.aiFairUseLimitEur ?? 0.5,
      usageCurrentPeriodEur: sub.aiUsageCurrentPeriodEur ?? 0,
      creditsEur: sub.aiCreditsEur ?? 0,
      overageCapEur: sub.aiOverageCapEur ?? 0,
      overageUsedEur: sub.aiOverageCurrentPeriodEur ?? 0,
      paused: sub.aiPaused ?? false,
    },
    transactionQuota: {
      currentCount: sub.transactionCountCurrentMonth ?? 0,
      month: sub.transactionCountMonth ?? null,
    },
  };
}

// ============================================================================
// Invoicing
// ============================================================================

export async function createInvoice(userId: string, args: Record<string, unknown>) {
  const { performCreateInvoice } = await import("../invoicing/createInvoice");
  const result = await performCreateInvoice(db, userId, {
    partnerId: args.partnerId as string,
    partnerType: ((args.partnerType as "user" | "global") || "user") as "user" | "global",
    issuerEntityId: args.issuerEntityId as string | undefined,
    issuerIban: args.issuerIban as string | undefined,
    issueDate: args.issueDate as string | undefined,
    paymentTerms: args.paymentTerms as string | undefined,
    currency: args.currency as string | undefined,
    lineItems: args.lineItems as Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate?: number;
    }> | undefined,
    notes: args.notes as string | undefined,
  });

  // Look up the freshly-created invoice number for the response.
  const snap = await db.collection("invoices").doc(result.invoiceId).get();
  const number = snap.exists ? (snap.data() as { number?: string }).number || "" : "";
  return { invoiceId: result.invoiceId, status: "draft" as const, number };
}

export async function updateInvoice(userId: string, args: Record<string, unknown>) {
  const { performUpdateInvoice } = await import("../invoicing/updateInvoice");
  if (!args.invoiceId) throw new Error("invoiceId is required");
  if (!args.patch || typeof args.patch !== "object") {
    throw new Error("patch is required");
  }
  const result = await performUpdateInvoice(db, userId, {
    invoiceId: args.invoiceId as string,
    patch: args.patch as Record<string, unknown>,
  });
  return { invoiceId: result.invoiceId, status: result.status };
}

export async function issueInvoice(userId: string, args: Record<string, unknown>) {
  const { performIssueInvoice } = await import("../invoicing/issueInvoice");
  const result = await performIssueInvoice(db, userId, {
    invoiceId: args.invoiceId as string,
    createShareLink: args.createShareLink as boolean | undefined,
  });
  const response: Record<string, unknown> = {
    invoiceId: result.invoiceId,
    fileId: result.fileId,
    downloadUrl: result.downloadUrl,
  };
  if (result.shareUrl) response.shareUrl = result.shareUrl;
  if (result.shareToken) response.shareToken = result.shareToken;
  return response;
}

export async function listInvoices(userId: string, args: Record<string, unknown>) {
  const { performListInvoices } = await import("../invoicing/listInvoices");
  const result = await performListInvoices(db, userId, {
    status: args.status as
      | "draft"
      | "issued"
      | "sent"
      | "paid"
      | "cancelled"
      | undefined,
    partnerId: args.partnerId as string | undefined,
    fromDate: args.fromDate as string | undefined,
    toDate: args.toDate as string | undefined,
    limit: args.limit as number | undefined,
  });
  return result.invoices;
}

export async function getInvoice(userId: string, args: Record<string, unknown>) {
  const { performGetInvoice } = await import("../invoicing/getInvoice");
  const result = await performGetInvoice(db, userId, {
    invoiceId: args.invoiceId as string,
  });
  const response: Record<string, unknown> = { invoice: result.invoice };
  if (result.downloadUrl) response.downloadUrl = result.downloadUrl;
  if (result.shareUrl) response.shareUrl = result.shareUrl;
  return response;
}

export async function duplicateInvoice(userId: string, args: Record<string, unknown>) {
  const { performDuplicateInvoice } = await import("../invoicing/duplicateInvoice");
  const result = await performDuplicateInvoice(db, userId, {
    invoiceId: args.invoiceId as string,
  });
  return { invoiceId: result.invoiceId };
}

export async function cancelInvoice(userId: string, args: Record<string, unknown>) {
  const { performCancelInvoice } = await import("../invoicing/cancelInvoice");
  const result = await performCancelInvoice(db, userId, {
    invoiceId: args.invoiceId as string,
  });
  return { invoiceId: result.invoiceId, status: result.status };
}
