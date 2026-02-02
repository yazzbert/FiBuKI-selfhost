"use strict";
/**
 * Cancel a scheduled account deletion.
 *
 * Allows users to cancel during the 30-day grace period.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelAccountDeletionCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
exports.cancelAccountDeletionCallable = (0, createCallable_1.createCallable)({ name: "cancelAccountDeletion" }, async (ctx) => {
    const { userId, db } = ctx;
    // Find pending deletion request
    const pendingRequests = await db
        .collection("accountDeletionRequests")
        .where("userId", "==", userId)
        .where("status", "==", "pending")
        .get();
    if (pendingRequests.empty) {
        throw new createCallable_1.HttpsError("not-found", "No pending account deletion request found.");
    }
    // Cancel all pending requests (should only be one)
    const batch = db.batch();
    for (const doc of pendingRequests.docs) {
        batch.update(doc.ref, {
            status: "cancelled",
            cancelledAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    // Remove pending deletion flag from user document
    await db.collection("users").doc(userId).update({
        pendingDeletion: firestore_1.FieldValue.delete(),
        scheduledDeletionDate: firestore_1.FieldValue.delete(),
    });
    console.log(`[CancelDeletion] User ${userId} cancelled account deletion`);
    return {
        success: true,
        message: "Account deletion cancelled. Your account will not be deleted.",
    };
});
//# sourceMappingURL=cancelAccountDeletionCallable.js.map