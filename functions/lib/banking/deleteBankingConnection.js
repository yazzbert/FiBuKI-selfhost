"use strict";
/**
 * Delete a banking connection
 *
 * Used for cleanup when resetting finAPI user or removing orphaned connections.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBankingConnectionCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
exports.deleteBankingConnectionCallable = (0, createCallable_1.createCallable)({ name: "deleteBankingConnection" }, async (ctx, request) => {
    const { connectionId } = request;
    if (!connectionId) {
        throw new createCallable_1.HttpsError("invalid-argument", "connectionId is required");
    }
    // Get connection and verify ownership
    const connectionRef = ctx.db.collection("bankingConnections").doc(connectionId);
    const connectionSnap = await connectionRef.get();
    if (!connectionSnap.exists) {
        // Already deleted - treat as success
        return { success: true };
    }
    const connection = connectionSnap.data();
    if (connection.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    await connectionRef.delete();
    console.log(`[deleteBankingConnection] Deleted connection ${connectionId}`, {
        userId: ctx.userId,
    });
    return { success: true };
});
//# sourceMappingURL=deleteBankingConnection.js.map