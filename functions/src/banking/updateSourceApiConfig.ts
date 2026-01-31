/**
 * Update source API config
 *
 * Updates the apiConfig for a source (e.g., token refresh, last sync time).
 * Used by finapi-connections route for token updates.
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import {
  UpdateSourceApiConfigRequest,
  UpdateSourceApiConfigResponse,
} from "../types/banking-sync";

export const updateSourceApiConfigCallable = createCallable<
  UpdateSourceApiConfigRequest,
  UpdateSourceApiConfigResponse
>(
  { name: "updateSourceApiConfig" },
  async (ctx, request) => {
    const { sourceId, apiConfig } = request;

    if (!sourceId) {
      throw new HttpsError("invalid-argument", "sourceId is required");
    }

    // Get source and verify ownership
    const sourceRef = ctx.db.collection("sources").doc(sourceId);
    const sourceSnap = await sourceRef.get();

    if (!sourceSnap.exists) {
      throw new HttpsError("not-found", "Source not found");
    }

    const source = sourceSnap.data()!;
    if (source.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Access denied");
    }

    if (source.type !== "api") {
      throw new HttpsError("invalid-argument", "Source is not an API source");
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: Timestamp.now(),
    };

    // Update apiConfig fields using dot notation
    for (const [key, value] of Object.entries(apiConfig)) {
      if (value === null) {
        updateData[`apiConfig.${key}`] = FieldValue.delete();
      } else if (key === "tokenExpiresAt" || key === "expiresAt" || key === "lastSyncAt") {
        // Convert dates to Timestamps
        if (value instanceof Date) {
          updateData[`apiConfig.${key}`] = Timestamp.fromDate(value);
        } else if (typeof value === "string") {
          updateData[`apiConfig.${key}`] = Timestamp.fromDate(new Date(value));
        } else {
          updateData[`apiConfig.${key}`] = value;
        }
      } else {
        updateData[`apiConfig.${key}`] = value;
      }
    }

    await sourceRef.update(updateData);

    console.log(`[updateSourceApiConfig] Updated source ${sourceId}`, {
      userId: ctx.userId,
      fields: Object.keys(apiConfig),
    });

    return { success: true };
  }
);
