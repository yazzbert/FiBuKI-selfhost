/**
 * Activate/deactivate the Investments addon for a user's subscription.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

interface ActivateAddonRequest {
  /** Not needed initially — addon is activated directly */
}

interface ActivateAddonResponse {
  success: boolean;
}

interface DeactivateAddonRequest {
  /** Not needed initially */
}

interface DeactivateAddonResponse {
  success: boolean;
}

export const activateInvestmentsAddonCallable = createCallable<
  ActivateAddonRequest,
  ActivateAddonResponse
>(
  { name: "activateInvestmentsAddon" },
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

    // Check if already active
    if (sub.addons?.investments?.active) {
      return { success: true };
    }

    // For now, activate directly without Stripe
    // TODO: integrate Stripe subscription item for billing
    await subRef.update({
      "addons.investments": {
        active: true,
        activatedAt: Timestamp.now(),
      },
      updatedAt: Timestamp.now(),
    });

    console.log(`[activateInvestmentsAddon] Activated for user ${ctx.userId}`);

    return { success: true };
  }
);

export const deactivateInvestmentsAddonCallable = createCallable<
  DeactivateAddonRequest,
  DeactivateAddonResponse
>(
  { name: "deactivateInvestmentsAddon" },
  async (ctx) => {
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    const subSnap = await subRef.get();

    if (!subSnap.exists) {
      throw new HttpsError("not-found", "No subscription found");
    }

    await subRef.update({
      "addons.investments.active": false,
      updatedAt: Timestamp.now(),
    });

    console.log(`[deactivateInvestmentsAddon] Deactivated for user ${ctx.userId}`);

    return { success: true };
  }
);
