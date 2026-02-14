"use strict";
/**
 * Update user's automation mode (active/passive)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAutomationModeCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.updateAutomationModeCallable = (0, createCallable_1.createCallable)({ name: "updateAutomationMode" }, async (ctx, request) => {
    const { mode } = request;
    if (mode !== "active" && mode !== "passive") {
        throw new createCallable_1.HttpsError("invalid-argument", "mode must be 'active' or 'passive'");
    }
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    await subRef.set({
        automationMode: mode,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[updateAutomationMode] User ${ctx.userId} set mode to "${mode}"`);
    return { success: true, mode };
});
//# sourceMappingURL=updateAutomationMode.js.map