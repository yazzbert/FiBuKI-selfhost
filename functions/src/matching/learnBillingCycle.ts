/**
 * Learn billing cycle from partner's transaction date intervals.
 *
 * This callable is the Firestore I/O around the derivation only: it reads the
 * partner's transactions (by `partnerId` — never `bankPartnerId`, a card
 * descriptor's partner must not pollute the supplier's cycle) and the extracted
 * dates of the files connected to them, hands both to the pure
 * `deriveBillingCycle`, and folds the result into what the partner already
 * carries. The algorithm itself lives in `billingCycleDerivation.ts`, so the
 * post-connect trigger, the nightly schedule and the MCP surface derive the
 * same cycle.
 *
 * A declared cycle is never overwritten here — see `mergeBillingCycle`.
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import {
  BILLING_CYCLE_CONFIG,
  BillingCycleInvoiceDate,
  BillingCycleTransaction,
  deriveBillingCycle,
  mergeBillingCycle,
  normalizeBillingCycle,
  toStoredBillingCycle,
} from "./billingCycleDerivation";

const db = getFirestore();

interface LearnBillingCycleRequest {
  partnerId: string;
}

interface LearnBillingCycleResponse {
  success: boolean;
  /** Stored shape: the legacy flat mirror plus learned / declared / effective. */
  billingCycle: Record<string, unknown> | null;
}

export const learnBillingCycleCallable = createCallable<
  LearnBillingCycleRequest,
  LearnBillingCycleResponse
>(
  { name: "learnBillingCycle" },
  async (ctx, request) => {
    const { partnerId } = request;

    if (!partnerId) {
      throw new HttpsError("invalid-argument", "partnerId is required");
    }

    // Verify partner ownership
    const partnerRef = ctx.db.collection("partners").doc(partnerId);
    const partnerSnap = await partnerRef.get();
    if (!partnerSnap.exists || partnerSnap.data()!.userId !== ctx.userId) {
      throw new HttpsError("not-found", "Partner not found");
    }

    // Query transactions for this partner, ordered by date
    const txSnapshot = await ctx.db
      .collection("transactions")
      .where("userId", "==", ctx.userId)
      .where("partnerId", "==", partnerId)
      .orderBy("date", "asc")
      .limit(BILLING_CYCLE_CONFIG.MAX_TRANSACTIONS)
      .get();

    if (txSnapshot.size < BILLING_CYCLE_CONFIG.MIN_TRANSACTIONS) {
      console.log(`[BillingCycle] Not enough transactions for partner ${partnerId}: ${txSnapshot.size}`);
      return { success: true, billingCycle: null };
    }

    const transactions: BillingCycleTransaction[] = txSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        date: data.date.toDate(),
        amount: typeof data.amount === "number" ? data.amount : undefined,
        currency: typeof data.currency === "string" ? data.currency : undefined,
      };
    });

    let connectedInvoiceDates: BillingCycleInvoiceDate[] = [];
    try {
      connectedInvoiceDates = await fetchConnectedInvoiceDates(
        ctx.userId,
        partnerId,
        txSnapshot.docs
      );
    } catch (err) {
      console.warn("[BillingCycle] Failed to read connected invoice dates:", err);
    }

    const now = new Date();
    const derived = deriveBillingCycle({ transactions, connectedInvoiceDates, now });

    if (derived.length === 0) {
      console.log(`[BillingCycle] No consistent interval found for partner ${partnerId}`);
      return { success: true, billingCycle: null };
    }

    const merged = mergeBillingCycle(
      normalizeBillingCycle(partnerSnap.data()!.billingCycle),
      derived
    );
    if (!merged) {
      return { success: true, billingCycle: null };
    }

    const billingCycle = toStoredBillingCycle(merged, (d) => Timestamp.fromDate(d), now);

    // Store on partner
    await partnerRef.update({
      billingCycle,
      updatedAt: Timestamp.now(),
    });

    const primary = derived[0];
    console.log(
      `[BillingCycle] Partner ${partnerId}: ${primary.frequencyDays}d cycle, ` +
      `${primary.frequencyConfidence}% confidence, day=${primary.typicalDayOfMonth}, ` +
      `delay=${primary.invoiceToTransactionDelay ?? "N/A"}d, sample=${primary.sampleSize}, ` +
      `bands=${merged.recurrences.length}`
    );

    return { success: true, billingCycle };
  }
);

/**
 * Read the extracted date of every file connected to one of the partner's
 * transactions. Only files that carry the partner themselves count — the same
 * rule the delay computation had before it moved into the pure function.
 */
async function fetchConnectedInvoiceDates(
  userId: string,
  partnerId: string,
  txDocs: FirebaseFirestore.QueryDocumentSnapshot[]
): Promise<BillingCycleInvoiceDate[]> {
  const txIds = txDocs.map((d) => d.id);
  const invoiceDates: BillingCycleInvoiceDate[] = [];

  // Process in batches of 30 (Firestore 'in' limit)
  for (let i = 0; i < txIds.length; i += 30) {
    const batch = txIds.slice(i, i + 30);
    const connections = await db
      .collection("fileConnections")
      .where("transactionId", "in", batch)
      .where("userId", "==", userId)
      .get();

    if (connections.empty) continue;

    const fileIds = [...new Set(connections.docs.map((d) => d.data().fileId))];

    // Fetch files to get extractedDate
    for (let j = 0; j < fileIds.length; j += 30) {
      const fileBatch = fileIds.slice(j, j + 30);
      const files = await db
        .collection("files")
        .where("__name__", "in", fileBatch)
        .get();

      for (const fileDoc of files.docs) {
        const fileData = fileDoc.data();
        if (!fileData.extractedDate || fileData.partnerId !== partnerId) continue;

        // Find the transaction this file is connected to
        const conn = connections.docs.find((c) => c.data().fileId === fileDoc.id);
        if (!conn) continue;

        const transactionId = conn.data().transactionId as string;
        if (!txIds.includes(transactionId)) continue;

        invoiceDates.push({
          transactionId,
          invoiceDate: fileData.extractedDate.toDate(),
        });
      }
    }
  }

  return invoiceDates;
}
