/**
 * Update user's automation mode (active/passive)
 */

import { FieldValue } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

interface UpdateAutomationModeRequest {
  mode: "active" | "passive";
}

interface UpdateAutomationModeResponse {
  success: boolean;
  mode: "active" | "passive";
}

export const updateAutomationModeCallable = createCallable<
  UpdateAutomationModeRequest,
  UpdateAutomationModeResponse
>(
  { name: "updateAutomationMode" },
  async (ctx, request) => {
    const { mode } = request;

    if (mode !== "active" && mode !== "passive") {
      throw new HttpsError("invalid-argument", "mode must be 'active' or 'passive'");
    }

    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);

    await subRef.set({
      automationMode: mode,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[updateAutomationMode] User ${ctx.userId} set mode to "${mode}"`);

    return { success: true, mode };
  }
);
