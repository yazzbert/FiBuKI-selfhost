import { createCallable, HttpsError } from "../utils/createCallable";
import { FieldValue } from "firebase-admin/firestore";

interface SetOpenSeatsRequest {
  totalSeats: number;
}

interface SetOpenSeatsResponse {
  success: boolean;
  totalSeats: number;
  remainingSeats: number;
}

export const setOpenSeatsCallable = createCallable<
  SetOpenSeatsRequest,
  SetOpenSeatsResponse
>(
  { name: "setOpenSeats" },
  async (ctx, request) => {
    // Admin only
    if (!ctx.request.auth?.token.admin) {
      throw new HttpsError("permission-denied", "Admin only");
    }

    const { totalSeats } = request;

    if (typeof totalSeats !== "number" || totalSeats < 0 || !Number.isInteger(totalSeats)) {
      throw new HttpsError("invalid-argument", "totalSeats must be a non-negative integer");
    }

    const configRef = ctx.db.collection("config").doc("openSeats");

    // Count all used invites for cumulative claimed seats
    const usedInvites = await ctx.db
      .collection("allowedEmails")
      .where("usedAt", "!=", null)
      .count()
      .get();
    const claimedSeats = usedInvites.data().count;

    const result = await ctx.db.runTransaction(async (tx) => {
      const doc = await tx.get(configRef);

      let remainingSeats: number;

      if (doc.exists) {
        const data = doc.data()!;
        const oldTotal = data.totalSeats as number;
        const oldRemaining = data.remainingSeats as number;
        const consumed = oldTotal - oldRemaining;
        remainingSeats = Math.max(0, totalSeats - consumed);
      } else {
        remainingSeats = totalSeats;
      }

      tx.set(configRef, {
        totalSeats,
        remainingSeats,
        claimedSeats,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ctx.userId,
      });

      return { totalSeats, remainingSeats };
    });

    return { success: true, ...result };
  }
);
