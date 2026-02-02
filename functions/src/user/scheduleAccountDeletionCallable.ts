/**
 * Schedule account deletion with 30-day grace period.
 *
 * Instead of immediately deleting, marks the account for deletion
 * after 30 days. User can cancel during this period.
 */

import { createCallable, HttpsError } from "../utils/createCallable";
import { Timestamp } from "firebase-admin/firestore";

const GRACE_PERIOD_DAYS = 30;

interface ScheduleAccountDeletionRequest {
  confirmationPhrase: string;
}

interface ScheduleAccountDeletionResponse {
  success: boolean;
  scheduledDeletionDate: string;
  gracePeriodDays: number;
}

export const scheduleAccountDeletionCallable = createCallable<
  ScheduleAccountDeletionRequest,
  ScheduleAccountDeletionResponse
>(
  { name: "scheduleAccountDeletion" },
  async (ctx, request) => {
    const { confirmationPhrase } = request;

    // Require exact confirmation phrase
    if (confirmationPhrase !== "DELETE MY ACCOUNT") {
      throw new HttpsError(
        "invalid-argument",
        "Invalid confirmation phrase. Please type 'DELETE MY ACCOUNT' exactly."
      );
    }

    const { userId, db } = ctx;

    // Check if deletion is already scheduled
    const existingRequest = await db
      .collection("accountDeletionRequests")
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!existingRequest.empty) {
      const existing = existingRequest.docs[0].data();
      throw new HttpsError(
        "already-exists",
        `Account deletion already scheduled for ${existing.scheduledDeletionDate.toDate().toISOString()}`
      );
    }

    // Calculate deletion date (30 days from now)
    const now = new Date();
    const deletionDate = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    // Create deletion request
    await db.collection("accountDeletionRequests").add({
      userId,
      status: "pending",
      requestedAt: Timestamp.now(),
      scheduledDeletionDate: Timestamp.fromDate(deletionDate),
      gracePeriodDays: GRACE_PERIOD_DAYS,
    });

    // Also update user document to show pending deletion
    await db.collection("users").doc(userId).set(
      {
        pendingDeletion: true,
        scheduledDeletionDate: Timestamp.fromDate(deletionDate),
      },
      { merge: true }
    );

    console.log(
      `[ScheduleDeletion] User ${userId} scheduled for deletion on ${deletionDate.toISOString()}`
    );

    return {
      success: true,
      scheduledDeletionDate: deletionDate.toISOString(),
      gracePeriodDays: GRACE_PERIOD_DAYS,
    };
  }
);
