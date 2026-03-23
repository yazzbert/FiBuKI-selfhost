"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setOpenSeatsCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
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
    return { success: true, ...result };
});
//# sourceMappingURL=openSeats.js.map