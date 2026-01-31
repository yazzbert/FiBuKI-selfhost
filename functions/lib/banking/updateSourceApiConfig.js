"use strict";
/**
 * Update source API config
 *
 * Updates the apiConfig for a source (e.g., token refresh, last sync time).
 * Used by finapi-connections route for token updates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSourceApiConfigCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.updateSourceApiConfigCallable = (0, createCallable_1.createCallable)({ name: "updateSourceApiConfig" }, async (ctx, request) => {
    const { sourceId, apiConfig } = request;
    if (!sourceId) {
        throw new createCallable_1.HttpsError("invalid-argument", "sourceId is required");
    }
    // Get source and verify ownership
    const sourceRef = ctx.db.collection("sources").doc(sourceId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Source not found");
    }
    const source = sourceSnap.data();
    if (source.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    if (source.type !== "api") {
        throw new createCallable_1.HttpsError("invalid-argument", "Source is not an API source");
    }
    // Build update object
    const updateData = {
        updatedAt: firestore_1.Timestamp.now(),
    };
    // Update apiConfig fields using dot notation
    for (const [key, value] of Object.entries(apiConfig)) {
        if (value === null) {
            updateData[`apiConfig.${key}`] = firestore_1.FieldValue.delete();
        }
        else if (key === "tokenExpiresAt" || key === "expiresAt" || key === "lastSyncAt") {
            // Convert dates to Timestamps
            if (value instanceof Date) {
                updateData[`apiConfig.${key}`] = firestore_1.Timestamp.fromDate(value);
            }
            else if (typeof value === "string") {
                updateData[`apiConfig.${key}`] = firestore_1.Timestamp.fromDate(new Date(value));
            }
            else {
                updateData[`apiConfig.${key}`] = value;
            }
        }
        else {
            updateData[`apiConfig.${key}`] = value;
        }
    }
    await sourceRef.update(updateData);
    console.log(`[updateSourceApiConfig] Updated source ${sourceId}`, {
        userId: ctx.userId,
        fields: Object.keys(apiConfig),
    });
    return { success: true };
});
//# sourceMappingURL=updateSourceApiConfig.js.map