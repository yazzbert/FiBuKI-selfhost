"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setOpenSeatsCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
const sendInviteEmail_1 = require("./sendInviteEmail");
exports.setOpenSeatsCallable = (0, createCallable_1.createCallable)({ name: "setOpenSeats" }, async (ctx, request) => {
    // Admin only
    if (!ctx.request.auth?.token.admin) {
        throw new createCallable_1.HttpsError("permission-denied", "Admin only");
    }
    const { totalSeats } = request;
    if (typeof totalSeats !== "number" || totalSeats < 0 || !Number.isInteger(totalSeats)) {
        throw new createCallable_1.HttpsError("invalid-argument", "totalSeats must be a non-negative integer");
    }
    const configRef = ctx.db.collection("config").doc("openSeats");
    // Count all used invites for cumulative claimed seats
    const usedInvites = await ctx.db
        .collection("allowedEmails")
        .where("usedAt", "!=", null)
        .count()
        .get();
    const claimedSeats = usedInvites.data().count;
    const result = await ctx.db.runTransaction(async (tx) => {
        const doc = await tx.get(configRef);
        let remainingSeats;
        if (doc.exists) {
            const data = doc.data();
            const oldTotal = data.totalSeats;
            const oldRemaining = data.remainingSeats;
            const consumed = oldTotal - oldRemaining;
            remainingSeats = Math.max(0, totalSeats - consumed);
        }
        else {
            remainingSeats = totalSeats;
        }
        tx.set(configRef, {
            totalSeats,
            remainingSeats,
            claimedSeats,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: ctx.userId,
        });
        return { totalSeats, remainingSeats };
    });
    // Auto-approve pending access requests if seats are available
    if (result.remainingSeats > 0) {
        const autoApproved = await autoApprovePendingRequests(ctx.db, result.remainingSeats, ctx.userId);
        if (autoApproved > 0) {
            // Update remaining seats and claimed seats after auto-approvals
            await configRef.update({
                remainingSeats: firestore_1.FieldValue.increment(-autoApproved),
                claimedSeats: firestore_1.FieldValue.increment(autoApproved),
            });
        }
    }
    return { success: true, ...result };
});
/**
 * Auto-approve pending access requests up to the number of available seats.
 */
async function autoApprovePendingRequests(db, maxApprovals, adminUserId) {
    const pendingRequests = await db
        .collection("accessRequests")
        .where("status", "==", "pending")
        .orderBy("requestedAt", "asc")
        .limit(maxApprovals)
        .get();
    if (pendingRequests.empty)
        return 0;
    let approved = 0;
    for (const requestDoc of pendingRequests.docs) {
        const data = requestDoc.data();
        // Create allowedEmails doc if not already there
        const existingAllowed = await db
            .collection("allowedEmails")
            .where("email", "==", data.email)
            .limit(1)
            .get();
        if (existingAllowed.empty) {
            await db.collection("allowedEmails").doc().set({
                email: data.email,
                addedBy: adminUserId,
                addedAt: firestore_1.FieldValue.serverTimestamp(),
                source: "open-seat-auto-approve",
            });
        }
        // Mark request as approved
        await requestDoc.ref.update({
            status: "approved",
            resolvedAt: firestore_1.FieldValue.serverTimestamp(),
            resolvedBy: adminUserId,
        });
        // Fire-and-forget invite email
        (0, sendInviteEmail_1.sendInviteEmail)(data.email).catch((err) => console.error("[autoApprove] Failed to send invite email:", err));
        approved++;
    }
    return approved;
}
//# sourceMappingURL=openSeats.js.map