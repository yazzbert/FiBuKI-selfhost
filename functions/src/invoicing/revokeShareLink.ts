/**
 * Revoke an invoice share link.
 * Sets invoiceShares/{token}.revokedAt; clears invoice.shareToken.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import { Invoice, InvoiceShare } from "./types";

export interface RevokeShareLinkRequest {
  invoiceId?: string;
  token?: string;
}

export interface RevokeShareLinkResponse {
  success: boolean;
}

/**
 * Internal implementation for revoking a share link.
 * Can be called directly from MCP handlers.
 */
export async function performRevokeInvoiceShareLink(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: RevokeShareLinkRequest,
): Promise<RevokeShareLinkResponse> {
  const token = request?.token;
  const invoiceId = request?.invoiceId;
  if (!token && !invoiceId) {
    throw new HttpsError("invalid-argument", "token or invoiceId is required");
  }

  const now = Timestamp.now();

  let resolvedToken = token;
  let resolvedInvoiceId = invoiceId;

  if (!resolvedToken && resolvedInvoiceId) {
    const invSnap = await db
      .collection("invoices")
      .doc(resolvedInvoiceId)
      .get();
    if (!invSnap.exists) {
      throw new HttpsError("not-found", "Invoice not found");
    }
    const inv = invSnap.data() as Invoice;
    if (inv.userId !== userId) {
      throw new HttpsError("permission-denied", "Not your invoice");
    }
    resolvedToken = inv.shareToken;
    if (!resolvedToken) {
      throw new HttpsError("failed-precondition", "Invoice has no active share link");
    }
  }

  if (!resolvedToken) {
    throw new HttpsError("invalid-argument", "Unable to resolve share token");
  }

  const shareRef = db.collection("invoiceShares").doc(resolvedToken);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    throw new HttpsError("not-found", "Share link not found");
  }
  const share = shareSnap.data() as InvoiceShare;
  if (share.userId !== userId) {
    throw new HttpsError("permission-denied", "Not your share link");
  }
  resolvedInvoiceId = resolvedInvoiceId || share.invoiceId;

  await shareRef.update({ revokedAt: now });
  if (resolvedInvoiceId) {
    await db.collection("invoices").doc(resolvedInvoiceId).update({
      shareToken: FieldValue.delete(),
      updatedAt: now,
    });
  }

  return { success: true };
}

export const revokeInvoiceShareLinkCallable = createCallable<
  RevokeShareLinkRequest,
  RevokeShareLinkResponse
>(
  { name: "revokeInvoiceShareLink" },
  async (ctx, request) => performRevokeInvoiceShareLink(ctx.db, ctx.userId, request),
);
