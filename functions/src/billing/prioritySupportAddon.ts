/**
 * Activate/deactivate the Priority Support addon for a user's subscription.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

export const activatePrioritySupportAddonCallable = createCallable<
  Record<string, never>,
  { success: boolean }
>(
  { name: "activatePrioritySupportAddon" },
  async (ctx) => {
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    const subSnap = await subRef.get();

    if (!subSnap.exists) {
      throw new HttpsError("not-found", "No subscription found");
    }

    const sub = subSnap.data()!;

    // Require an active Stripe subscription
    if (!sub.stripeSubscriptionId || sub.stripeSubscriptionStatus === "canceled") {
      throw new HttpsError("failed-precondition", "Active subscription required");
    }

    if (sub.addons?.prioritySupport?.active) {
      return { success: true };
    }

    // TODO: integrate Stripe subscription item for billing
    await subRef.update({
      "addons.prioritySupport": {
        active: true,
        activatedAt: Timestamp.now(),
      },
      updatedAt: Timestamp.now(),
    });

    console.log(`[activatePrioritySupportAddon] Activated for user ${ctx.userId}`);
    return { success: true };
  }
);

export const deactivatePrioritySupportAddonCallable = createCallable<
  Record<string, never>,
  { success: boolean }
>(
  { name: "deactivatePrioritySupportAddon" },
  async (ctx) => {
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    const subSnap = await subRef.get();

    if (!subSnap.exists) {
      throw new HttpsError("not-found", "No subscription found");
    }

    await subRef.update({
      "addons.prioritySupport.active": false,
      updatedAt: Timestamp.now(),
    });

    console.log(`[deactivatePrioritySupportAddon] Deactivated for user ${ctx.userId}`);
    return { success: true };
  }
);
