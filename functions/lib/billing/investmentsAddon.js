"use strict";
/**
 * Activate/deactivate the Investments addon for a user's subscription.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateInvestmentsAddonCallable = exports.activateInvestmentsAddonCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.activateInvestmentsAddonCallable = (0, createCallable_1.createCallable)({ name: "activateInvestmentsAddon" }, async (ctx) => {
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "No subscription found");
    }
    const sub = subSnap.data();
    // Check if already active
    if (sub.addons?.investments?.active) {
        return { success: true };
    }
    // For now, activate directly without Stripe
    // TODO: integrate Stripe subscription item for billing
    await subRef.update({
        "addons.investments": {
            active: true,
            activatedAt: firestore_1.Timestamp.now(),
        },
        updatedAt: firestore_1.Timestamp.now(),
    });
    console.log(`[activateInvestmentsAddon] Activated for user ${ctx.userId}`);
    return { success: true };
});
exports.deactivateInvestmentsAddonCallable = (0, createCallable_1.createCallable)({ name: "deactivateInvestmentsAddon" }, async (ctx) => {
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "No subscription found");
    }
    await subRef.update({
        "addons.investments.active": false,
        updatedAt: firestore_1.Timestamp.now(),
    });
    console.log(`[deactivateInvestmentsAddon] Deactivated for user ${ctx.userId}`);
    return { success: true };
});
//# sourceMappingURL=investmentsAddon.js.map