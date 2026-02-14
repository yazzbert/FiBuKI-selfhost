/**
 * Cloud Function: Reject Reconciliation
 *
 * Rejects a suggested reconciliation group, clearing all denormalized fields.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

interface RejectReconciliationRequest {
  groupId: string;
}

interface RejectReconciliationResponse {
  success: boolean;
}

export const rejectReconciliationCallable = createCallable<
  RejectReconciliationRequest,
  RejectReconciliationResponse
>(
  { name: "rejectReconciliation" },
  async (ctx, request) => {
    const { groupId } = request;

    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId is required");
    }

    // Get the reconciliation group
    const groupRef = ctx.db.collection("cardReconciliationGroups").doc(groupId);
    const groupSnap = await groupRef.get();

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "Reconciliation group not found");
    }

    const group = groupSnap.data()!;

    if (group.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Access denied");
    }

    if (group.status === "rejected") {
      return { success: true };
    }

    const now = Timestamp.now();
    const batch = ctx.db.batch();

    // Update group to rejected
    batch.update(groupRef, {
      status: "rejected",
      updatedAt: now,
    });

    // If the group was previously confirmed, clear card transaction fields
    if (group.status === "confirmed") {
      for (const txId of group.cardTransactionIds) {
        const txRef = ctx.db.collection("transactions").doc(txId);
        batch.update(txRef, {
          reconciledByBankTxId: null,
          reconciliationGroupId: null,
          updatedAt: now,
        });
      }
    }

    // Remove the suggestion from bank transaction (filter out this group)
    const bankTxRef = ctx.db
      .collection("transactions")
      .doc(group.bankTransactionId);
    const bankTxSnap = await bankTxRef.get();

    if (bankTxSnap.exists) {
      const bankTxData = bankTxSnap.data()!;
      const suggestions = bankTxData.reconciliationSuggestions || [];
      const filtered = suggestions.filter(
        (s: { groupId: string }) => s.groupId !== groupId
      );

      batch.update(bankTxRef, {
        reconciliationSuggestions: filtered.length > 0 ? filtered : FieldValue.delete(),
        updatedAt: now,
      });
    }

    await batch.commit();

    console.log(
      `[Reconciliation] Rejected group ${groupId} ` +
      `(was ${group.status}, bank tx: ${group.bankTransactionId})`
    );

    return { success: true };
  }
);
