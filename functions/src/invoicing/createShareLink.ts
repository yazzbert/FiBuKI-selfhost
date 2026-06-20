/**
 * Create a shareable link for an issued invoice.
 * Generates a 32-byte url-safe random token.
 */

import { Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { createCallable, HttpsError } from "../utils/createCallable";
import { Invoice } from "./types";

export interface CreateShareLinkRequest {
  invoiceId: string;
}

export interface CreateShareLinkResponse {
  success: boolean;
  token: string;
  shareUrl: string;
}

function genShareToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Internal implementation for creating a share link.
 * Can be called directly from MCP handlers.
 */
export async function performCreateInvoiceShareLink(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: CreateShareLinkRequest,
): Promise<CreateShareLinkResponse> {
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
  if (inv.status === "draft") {
    throw new HttpsError(
      "failed-precondition",
      "Only issued invoices can be shared",
    );
  }

  const token = genShareToken();
  const now = Timestamp.now();
  await db.collection("invoiceShares").doc(token).set({
    token,
    invoiceId: request.invoiceId,
    userId,
    createdAt: now,
    accessCount: 0,
  });

  await invoiceRef.update({
    shareToken: token,
    shareTokenCreatedAt: now,
    updatedAt: now,
  });

  return { success: true, token, shareUrl: `/i/${token}` };
}

export const createInvoiceShareLinkCallable = createCallable<
  CreateShareLinkRequest,
  CreateShareLinkResponse
>(
  { name: "createInvoiceShareLink" },
  async (ctx, request) => performCreateInvoiceShareLink(ctx.db, ctx.userId, request),
);
