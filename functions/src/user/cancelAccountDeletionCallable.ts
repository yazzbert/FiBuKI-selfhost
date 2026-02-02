/**
 * Cancel a scheduled account deletion.
 *
 * Allows users to cancel during the 30-day grace period.
 */

import { createCallable, HttpsError } from "../utils/createCallable";
import { FieldValue } from "firebase-admin/firestore";

interface CancelAccountDeletionRequest {}

interface CancelAccountDeletionResponse {
  success: boolean;
  message: string;
}

export const cancelAccountDeletionCallable = createCallable<
  CancelAccountDeletionRequest,
  CancelAccountDeletionResponse
>(
  { name: "cancelAccountDeletion" },
  async (ctx) => {
    const { userId, db } = ctx;

    // Find pending deletion request
    const pendingRequests = await db
      .collection("accountDeletionRequests")
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();

    if (pendingRequests.empty) {
      throw new HttpsError(
        "not-found",
        "No pending account deletion request found."
      );
    }

    // Cancel all pending requests (should only be one)
    const batch = db.batch();
    for (const doc of pendingRequests.docs) {
      batch.update(doc.ref, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    // Remove pending deletion flag from user document
    await db.collection("users").doc(userId).update({
      pendingDeletion: FieldValue.delete(),
      scheduledDeletionDate: FieldValue.delete(),
    });

    console.log(`[CancelDeletion] User ${userId} cancelled account deletion`);

    return {
      success: true,
      message: "Account deletion cancelled. Your account will not be deleted.",
    };
  }
);
