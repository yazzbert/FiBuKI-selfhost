"use strict";
/**
 * Cloud Function: Reject Reconciliation
 *
 * Rejects a suggested reconciliation group, clearing all denormalized fields.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectReconciliationCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.rejectReconciliationCallable = (0, createCallable_1.createCallable)({ name: "rejectReconciliation" }, async (ctx, request) => {
    const { groupId } = request;
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
    if (group.status === "rejected") {
        return { success: true };
    }
    const now = firestore_1.Timestamp.now();
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
        const bankTxData = bankTxSnap.data();
        const suggestions = bankTxData.reconciliationSuggestions || [];
        const filtered = suggestions.filter((s) => s.groupId !== groupId);
        batch.update(bankTxRef, {
            reconciliationSuggestions: filtered.length > 0 ? filtered : firestore_1.FieldValue.delete(),
            updatedAt: now,
        });
    }
    await batch.commit();
    console.log(`[Reconciliation] Rejected group ${groupId} ` +
        `(was ${group.status}, bank tx: ${group.bankTransactionId})`);
    return { success: true };
});
//# sourceMappingURL=rejectReconciliation.js.map