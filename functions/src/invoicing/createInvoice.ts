/**
 * Create a draft invoice.
 *
 * Returns the new invoiceId. Snapshots issuer + recipient at creation time.
 * Number is a "DRAFT-{shortId}" placeholder; the real number is allocated
 * atomically at issue time.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import {
  DEFAULT_CURRENCY,
  DEFAULT_PAYMENT_TERMS,
  DEFAULT_VAT_RATE,
  Invoice,
  InvoiceLineItem,
  computeInvoiceTotals,
  parsePaymentTermsToDays,
} from "./types";
import {
  buildIssuerSnapshot,
  buildRecipientSnapshot,
  loadUserIdentity,
  pickIssuerEntity,
  pickIssuerIban,
} from "./snapshots";

export interface CreateInvoiceLineItemInput {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
}

export interface CreateInvoiceRequest {
  partnerId: string;
  partnerType: "user" | "global";
  issuerEntityId?: string;
  issuerIban?: string;
  /** ISO date string. Defaults to today. */
  issueDate?: string;
  paymentTerms?: string;
  currency?: string;
  lineItems?: CreateInvoiceLineItemInput[];
  notes?: string;
}

export interface CreateInvoiceResponse {
  success: boolean;
  invoiceId: string;
}

function shortRandomId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function genLineItemId(): string {
  return `li_${Math.random().toString(36).slice(2, 10)}`;
}

function parseIsoDateToTimestamp(iso?: string): Timestamp {
  if (!iso) return Timestamp.now();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return Timestamp.now();
  return Timestamp.fromDate(d);
}

function addDaysToTimestamp(ts: Timestamp, days: number): Timestamp {
  const d = ts.toDate();
  d.setDate(d.getDate() + days);
  return Timestamp.fromDate(d);
}

function normalizeLineItems(
  items: CreateInvoiceLineItemInput[] | undefined,
): InvoiceLineItem[] {
  if (!items || items.length === 0) return [];
  return items.map((raw) => ({
    id: raw.id || genLineItemId(),
    description: String(raw.description || "").trim(),
    quantity: Number(raw.quantity) || 0,
    unitPrice: Math.round(Number(raw.unitPrice) || 0),
    vatRate: raw.vatRate !== undefined ? Number(raw.vatRate) : DEFAULT_VAT_RATE,
  }));
}

/**
 * Internal implementation for creating an invoice.
 * Can be called directly from MCP handlers.
 */
export async function performCreateInvoice(
  db: FirebaseFirestore.Firestore,
  userId: string,
  request: CreateInvoiceRequest,
): Promise<CreateInvoiceResponse> {
  if (!request?.partnerId) {
    throw new HttpsError("invalid-argument", "partnerId is required");
  }
  if (request.partnerType !== "user" && request.partnerType !== "global") {
    throw new HttpsError("invalid-argument", "partnerType must be 'user' or 'global'");
  }

  // Recipient snapshot
  const recipient = await buildRecipientSnapshot(
    db,
    request.partnerId,
    request.partnerType,
    userId,
  );
  if (!recipient) {
    throw new HttpsError("not-found", "Partner not found or not accessible");
  }

  // Issuer snapshot from user identity
  const userData = await loadUserIdentity(db, userId);
  const entity = pickIssuerEntity(userData, request.issuerEntityId);
  if (!entity) {
    throw new HttpsError(
      "failed-precondition",
      "No identity entity configured. Add one in Settings before creating invoices.",
    );
  }
  const iban = pickIssuerIban(entity, request.issuerIban);
  if (!iban) {
    throw new HttpsError(
      "failed-precondition",
      "Selected identity has no IBAN configured.",
    );
  }
  if (request.issuerIban && !entity.ibans?.includes(request.issuerIban)) {
    throw new HttpsError(
      "invalid-argument",
      "issuerIban does not belong to the selected entity",
    );
  }
  const issuer = buildIssuerSnapshot(entity, iban);

  // Dates
  const issueDate = parseIsoDateToTimestamp(request.issueDate);
  const paymentTerms = request.paymentTerms || DEFAULT_PAYMENT_TERMS;
  const dueDate = addDaysToTimestamp(issueDate, parsePaymentTermsToDays(paymentTerms));

  // Line items + totals
  const lineItems = normalizeLineItems(request.lineItems);
  const { subtotal, vatAmount, total } = computeInvoiceTotals(lineItems);

  const now = Timestamp.now();
  const docRef = db.collection("invoices").doc();

  const invoiceData: Omit<Invoice, "id"> = {
    userId,
    number: `DRAFT-${shortRandomId()}`,
    status: "draft",
    issuer,
    recipient,
    issueDate,
    paymentTerms,
    dueDate,
    lineItems,
    currency: request.currency || DEFAULT_CURRENCY,
    subtotal,
    vatAmount,
    total,
    createdAt: now,
    updatedAt: now,
  };

  if (request.notes) {
    (invoiceData as Invoice).notes = request.notes;
  }

  await docRef.set(invoiceData);

  return { success: true, invoiceId: docRef.id };
}

export const createInvoiceCallable = createCallable<
  CreateInvoiceRequest,
  CreateInvoiceResponse
>(
  { name: "createInvoice" },
  async (ctx, request) => performCreateInvoice(ctx.db, ctx.userId, request),
);
