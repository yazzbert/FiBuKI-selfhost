"use strict";
/**
 * Automation Mode Guard
 *
 * Checks a user's automation mode (active vs passive).
 * In passive mode, AI-powered steps are skipped while deterministic
 * matching and scoring still run.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAutomationMode = getAutomationMode;
exports.isPassiveMode = isPassiveMode;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * Get the user's automation mode from their subscription.
 * Defaults to "active" if not set.
 */
async function getAutomationMode(userId) {
    const subDoc = await db.collection("subscriptions").doc(userId).get();
    if (!subDoc.exists)
        return "active";
    return subDoc.data()?.automationMode || "active";
}
/**
 * Check if user is in passive mode.
 */
async function isPassiveMode(userId) {
    return (await getAutomationMode(userId)) === "passive";
}
//# sourceMappingURL=checkAutomationMode.js.map