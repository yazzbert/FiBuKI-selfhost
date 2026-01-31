/**
 * Delete a banking connection
 *
 * Used for cleanup when resetting finAPI user or removing orphaned connections.
 */

import { createCallable, HttpsError } from "../utils/createCallable";

interface DeleteBankingConnectionRequest {
  connectionId: string;
}

interface DeleteBankingConnectionResponse {
  success: boolean;
}

export const deleteBankingConnectionCallable = createCallable<
  DeleteBankingConnectionRequest,
  DeleteBankingConnectionResponse
>(
  { name: "deleteBankingConnection" },
  async (ctx, request) => {
    const { connectionId } = request;

    if (!connectionId) {
      throw new HttpsError("invalid-argument", "connectionId is required");
    }

    // Get connection and verify ownership
    const connectionRef = ctx.db.collection("bankingConnections").doc(connectionId);
    const connectionSnap = await connectionRef.get();

    if (!connectionSnap.exists) {
      // Already deleted - treat as success
      return { success: true };
    }

    const connection = connectionSnap.data()!;
    if (connection.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Access denied");
    }

    await connectionRef.delete();

    console.log(`[deleteBankingConnection] Deleted connection ${connectionId}`, {
      userId: ctx.userId,
    });

    return { success: true };
  }
);
