/**
 * Update a banking connection
 *
 * Updates connection status and data after web form completion,
 * token refresh, or error states.
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import {
  UpdateBankingConnectionRequest,
  UpdateBankingConnectionResponse,
} from "../types/banking-sync";

export const updateBankingConnectionCallable = createCallable<
  UpdateBankingConnectionRequest,
  UpdateBankingConnectionResponse
>(
  { name: "updateBankingConnection" },
  async (ctx, request) => {
    const { connectionId, updates } = request;

    if (!connectionId) {
      throw new HttpsError("invalid-argument", "connectionId is required");
    }

    // Get connection and verify ownership
    const connectionRef = ctx.db.collection("bankingConnections").doc(connectionId);
    const connectionSnap = await connectionRef.get();

    if (!connectionSnap.exists) {
      throw new HttpsError("not-found", "Banking connection not found");
    }

    const connection = connectionSnap.data()!;
    if (connection.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Access denied");
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: Timestamp.now(),
    };

    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }

    if (updates.statusMessage !== undefined) {
      if (updates.statusMessage === null) {
        updateData.statusMessage = FieldValue.delete();
      } else {
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
  }
);
