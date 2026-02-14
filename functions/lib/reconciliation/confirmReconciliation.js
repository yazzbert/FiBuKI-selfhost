"use strict";
/**
 * Cloud Function: Confirm Reconciliation
 *
 * Confirms a suggested reconciliation group, marking card transactions
 * as reconciled and clearing suggestions from the bank transaction.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmReconciliationCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.confirmReconciliationCallable = (0, createCallable_1.createCallable)({ name: "confirmReconciliation" }, async (ctx, request) => {
    const { groupId, cardTransactionIds: overrideIds, note } = request;
    if (!groupId) {
        throw new createCallable_1.HttpsError("invalid-argument", "groupId is required");
    }
    // Get the reconciliation group
    const groupRef = ctx.db.collection("cardReconciliationGroups").doc(groupId);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Reconciliation group not found");
    }
    const group = groupSnap.data();
    if (group.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    if (group.status === "confirmed") {
        return { success: true, reconciledCount: group.cardTransactionIds.length };
    }
    if (group.status === "rejected") {
        throw new createCallable_1.HttpsError("failed-precondition", "Cannot confirm a rejected group. Create a new reconciliation instead.");
    }
    // Use override IDs if provided, otherwise use the group's original IDs
    const finalCardTxIds = overrideIds || group.cardTransactionIds;
    const rejectedIds = overrideIds
        ? group.cardTransactionIds.filter((id) => !overrideIds.includes(id))
        : [];
    // Recalculate charges sum if IDs were overridden
    let cardChargesSum = group.cardChargesSum;
    if (overrideIds && overrideIds.length !== group.cardTransactionIds.length) {
        // Need to recalculate from actual transaction amounts
        let sum = 0;
        for (const txId of finalCardTxIds) {
            const txDoc = await ctx.db.collection("transactions").doc(txId).get();
            if (txDoc.exists) {
                sum += Math.abs(txDoc.data().amount);
            }
        }
        cardChargesSum = sum;
    }
    const now = firestore_1.Timestamp.now();
    const batch = ctx.db.batch();
    // Update group to confirmed
    const groupUpdate = {
        status: "confirmed",
        cardTransactionIds: finalCardTxIds,
        cardChargesSum,
        remainderAmount: group.bankPaymentAmount - cardChargesSum,
        updatedAt: now,
    };
    if (rejectedIds.length > 0) {
        groupUpdate.rejectedCardTransactionIds = rejectedIds;
    }
    if (note !== undefined) {
        groupUpdate.note = note || null;
    }
    batch.update(groupRef, groupUpdate);
    // Mark card transactions as reconciled
    for (const txId of finalCardTxIds) {
        const txRef = ctx.db.collection("transactions").doc(txId);
        batch.update(txRef, {
            reconciledByBankTxId: group.bankTransactionId,
            reconciliationGroupId: groupId,
            updatedAt: now,
        });
    }
    // Clear rejected card transactions' reconciliation fields (if any were previously set)
    for (const txId of rejectedIds) {
        const txRef = ctx.db.collection("transactions").doc(txId);
        batch.update(txRef, {
            reconciledByBankTxId: null,
            reconciliationGroupId: null,
            updatedAt: now,
        });
    }
    // Clear suggestions from bank transaction
    const bankTxRef = ctx.db
        .collection("transactions")
        .doc(group.bankTransactionId);
    batch.update(bankTxRef, {
        reconciliationSuggestions: firestore_1.FieldValue.delete(),
        reconciliationMatchComplete: true,
        updatedAt: now,
    });
    await batch.commit();
    console.log(`[Reconciliation] Confirmed group ${groupId}: ` +
        `${finalCardTxIds.length} card txs reconciled with bank tx ${group.bankTransactionId}`);
    return {
        success: true,
        reconciledCount: finalCardTxIds.length,
    };
});
//# sourceMappingURL=confirmReconciliation.js.map