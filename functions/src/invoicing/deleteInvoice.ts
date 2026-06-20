/**
 * Hard-delete a draft invoice. Throws unless status === "draft".
 * Also removes any linked file (which should be unusual for drafts).
 */

import { createCallable, HttpsError } from "../utils/createCallable";
import { Invoice } from "./types";

export interface DeleteInvoiceRequest {
  invoiceId: string;
}

export interface DeleteInvoiceResponse {
  success: boolean;
  invoiceId: string;
}

/**
 * Internal implementation for hard-deleting a draft invoice.
 * Can be called directly from MCP handlers.
 */
export async function performDeleteInvoice(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: DeleteInvoiceRequest,
): Promise<DeleteInvoiceResponse> {
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
  if (inv.status !== "draft") {
    throw new HttpsError("failed-precondition", "Only drafts can be hard-deleted");
  }

  if (inv.fileId) {
    await db.collection("files").doc(inv.fileId).delete().catch(() => undefined);
  }
  await invoiceRef.delete();

  return { success: true, invoiceId: request.invoiceId };
}

export const deleteInvoiceCallable = createCallable<
  DeleteInvoiceRequest,
  DeleteInvoiceResponse
>(
  { name: "deleteInvoice" },
  async (ctx, request) => performDeleteInvoice(ctx.db, ctx.userId, request),
);
