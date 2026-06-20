/**
 * List invoices for the authenticated user.
 * Supports optional filters: status, partnerId, fromDate, toDate, limit.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import { Invoice, InvoiceStatus } from "./types";

export interface ListInvoicesRequest {
  status?: InvoiceStatus;
  partnerId?: string;
  /** ISO date strings */
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface ListInvoicesResponse {
  invoices: Invoice[];
}

function parseDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Internal implementation for listing invoices.
 * Can be called directly from MCP handlers.
 */
export async function performListInvoices(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: ListInvoicesRequest,
): Promise<ListInvoicesResponse> {
  const limit = Math.min(Math.max(request?.limit ?? 100, 1), 500);

  let q: FirebaseFirestore.Query = db
    .collection("invoices")
    .where("userId", "==", userId);

  if (request?.status) {
    q = q.where("status", "==", request.status);
  }
  if (request?.partnerId) {
    q = q.where("recipient.partnerId", "==", request.partnerId);
  }

  const from = parseDate(request?.fromDate);
  if (from) q = q.where("issueDate", ">=", Timestamp.fromDate(from));
  const to = parseDate(request?.toDate);
  if (to) q = q.where("issueDate", "<=", Timestamp.fromDate(to));

  try {
    q = q.orderBy("issueDate", "desc").limit(limit);
    const snap = await q.get();
    const invoices: Invoice[] = snap.docs.map((d) => ({
      ...(d.data() as Invoice),
      id: d.id,
    }));
    return { invoices };
  } catch (err) {
    // Fallback: composite index may not exist yet. Drop orderBy.
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("requires an index")) {
      const snap = await q.limit(limit).get();
      const invoices: Invoice[] = snap.docs.map((d) => ({
        ...(d.data() as Invoice),
        id: d.id,
      }));
      return { invoices };
    }
    throw new HttpsError("internal", "Failed to list invoices");
  }
}

export const listInvoicesCallable = createCallable<
  ListInvoicesRequest,
  ListInvoicesResponse
>(
  { name: "listInvoices" },
  async (ctx, request) => performListInvoices(ctx.db, ctx.userId, request),
);
