"use strict";
/**
 * Schedule account deletion with 30-day grace period.
 *
 * Instead of immediately deleting, marks the account for deletion
 * after 30 days. User can cancel during this period.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleAccountDeletionCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
const GRACE_PERIOD_DAYS = 30;
exports.scheduleAccountDeletionCallable = (0, createCallable_1.createCallable)({ name: "scheduleAccountDeletion" }, async (ctx, request) => {
    const { confirmationPhrase } = request;
    // Require exact confirmation phrase
    if (confirmationPhrase !== "DELETE MY ACCOUNT") {
        throw new createCallable_1.HttpsError("invalid-argument", "Invalid confirmation phrase. Please type 'DELETE MY ACCOUNT' exactly.");
    }
    const { userId, db } = ctx;
    // Check if deletion is already scheduled
    const existingRequest = await db
        .collection("accountDeletionRequests")
        .where("userId", "==", userId)
        .where("status", "==", "pending")
        .limit(1)
        .get();
    if (!existingRequest.empty) {
        const existing = existingRequest.docs[0].data();
        throw new createCallable_1.HttpsError("already-exists", `Account deletion already scheduled for ${existing.scheduledDeletionDate.toDate().toISOString()}`);
    }
    // Calculate deletion date (30 days from now)
    const now = new Date();
    const deletionDate = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    // Create deletion request
    await db.collection("accountDeletionRequests").add({
        userId,
        status: "pending",
        requestedAt: firestore_1.Timestamp.now(),
        scheduledDeletionDate: firestore_1.Timestamp.fromDate(deletionDate),
        gracePeriodDays: GRACE_PERIOD_DAYS,
    });
    // Also update user document to show pending deletion
    await db.collection("users").doc(userId).set({
        pendingDeletion: true,
        scheduledDeletionDate: firestore_1.Timestamp.fromDate(deletionDate),
    }, { merge: true });
    console.log(`[ScheduleDeletion] User ${userId} scheduled for deletion on ${deletionDate.toISOString()}`);
    return {
        success: true,
        scheduledDeletionDate: deletionDate.toISOString(),
        gracePeriodDays: GRACE_PERIOD_DAYS,
    };
});
//# sourceMappingURL=scheduleAccountDeletionCallable.js.map