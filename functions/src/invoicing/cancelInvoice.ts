/**
 * Cancel an issued/sent/paid invoice. Sets status=cancelled, fills cancelledAt,
 * soft-deletes the linked TaxFile.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import { Invoice } from "./types";

export interface CancelInvoiceRequest {
  invoiceId: string;
}

export interface CancelInvoiceResponse {
  success: boolean;
  invoiceId: string;
  status: "cancelled";
}

/**
 * Internal implementation for cancelling an invoice.
 * Can be called directly from MCP handlers.
 */
export async function performCancelInvoice(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: CancelInvoiceRequest,
): Promise<CancelInvoiceResponse> {
  if (!request?.invoiceId) {
    throw new HttpsError("invalid-argument", "invoiceId is required");
  }
  const invoiceRef = db.collection("invoices").doc(request.invoiceId);
  const snap = await invoiceRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Invoice not found");
  }
  const inv = snap.data() as Invoice;
  if (inv.userId !== userId) {
    throw new HttpsError("permission-denied", "Not your invoice");
  }
  if (inv.status !== "issued" && inv.status !== "sent" && inv.status !== "paid") {
    throw new HttpsError(
      "failed-precondition",
      "Only issued/sent/paid invoices can be cancelled",
    );
  }

  const now = Timestamp.now();
  await invoiceRef.update({
    status: "cancelled",
    cancelledAt: now,
    updatedAt: now,
  });

  if (inv.fileId) {
    await db.collection("files").doc(inv.fileId).update({
      deletedAt: now,
      updatedAt: now,
    });
  }

  return { success: true, invoiceId: request.invoiceId, status: "cancelled" };
}

export const cancelInvoiceCallable = createCallable<
  CancelInvoiceRequest,
  CancelInvoiceResponse
>(
  { name: "cancelInvoice" },
  async (ctx, request) => performCancelInvoice(ctx.db, ctx.userId, request),
);
