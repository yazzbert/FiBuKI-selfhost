/**
 * Get a single invoice plus linked file's downloadUrl + shareUrl if any.
 */

import { createCallable, HttpsError } from "../utils/createCallable";
import { Invoice } from "./types";

export interface GetInvoiceRequest {
  invoiceId: string;
}

export interface GetInvoiceResponse {
  invoice: Invoice;
  downloadUrl?: string;
  shareUrl?: string;
}

/**
 * Internal implementation for getting an invoice.
 * Can be called directly from MCP handlers.
 */
export async function performGetInvoice(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: GetInvoiceRequest,
): Promise<GetInvoiceResponse> {
  if (!request?.invoiceId) {
    throw new HttpsError("invalid-argument", "invoiceId is required");
  }

  const snap = await db.collection("invoices").doc(request.invoiceId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Invoice not found");
  }
  const data = snap.data() as Invoice;
  if (data.userId !== userId) {
    throw new HttpsError("permission-denied", "Not your invoice");
  }

  const invoice: Invoice = { ...data, id: snap.id };

  const response: GetInvoiceResponse = { invoice };

  if (invoice.fileId) {
    const fileSnap = await db.collection("files").doc(invoice.fileId).get();
    if (fileSnap.exists) {
      const fileData = fileSnap.data() as { downloadUrl?: string };
      if (fileData.downloadUrl) response.downloadUrl = fileData.downloadUrl;
    }
  }

  if (invoice.shareToken) {
    response.shareUrl = `/i/${invoice.shareToken}`;
  }

  return response;
}

export const getInvoiceCallable = createCallable<
  GetInvoiceRequest,
  GetInvoiceResponse
>(
  { name: "getInvoice" },
  async (ctx, request) => performGetInvoice(ctx.db, ctx.userId, request),
);
