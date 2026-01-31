"use strict";
/**
 * Update a banking connection
 *
 * Updates connection status and data after web form completion,
 * token refresh, or error states.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBankingConnectionCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.updateBankingConnectionCallable = (0, createCallable_1.createCallable)({ name: "updateBankingConnection" }, async (ctx, request) => {
    const { connectionId, updates } = request;
    if (!connectionId) {
        throw new createCallable_1.HttpsError("invalid-argument", "connectionId is required");
    }
    // Get connection and verify ownership
    const connectionRef = ctx.db.collection("bankingConnections").doc(connectionId);
    const connectionSnap = await connectionRef.get();
    if (!connectionSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Banking connection not found");
    }
    const connection = connectionSnap.data();
    if (connection.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    // Build update object
    const updateData = {
        updatedAt: firestore_1.Timestamp.now(),
    };
    if (updates.status !== undefined) {
        updateData.status = updates.status;
    }
    if (updates.statusMessage !== undefined) {
        if (updates.statusMessage === null) {
            updateData.statusMessage = firestore_1.FieldValue.delete();
        }
        else {
            updateData.statusMessage = updates.statusMessage;
        }
    }
    if (updates.providerData !== undefined) {
        // Merge with existing provider data
        updateData.providerData = {
            ...connection.providerData,
            ...updates.providerData,
        };
    }
    if (updates.linkedSourceId !== undefined) {
        updateData.linkedSourceId = updates.linkedSourceId;
    }
    await connectionRef.update(updateData);
    console.log(`[updateBankingConnection] Updated connection ${connectionId}`, {
        userId: ctx.userId,
        fields: Object.keys(updates),
    });
    return { success: true };
});
//# sourceMappingURL=updateBankingConnection.js.map