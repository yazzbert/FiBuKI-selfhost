/**
 * Activate/deactivate the BMD/NTCS Export addon for a user's subscription.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

export const activateBmdExportAddonCallable = createCallable<
  Record<string, never>,
  { success: boolean }
>(
  { name: "activateBmdExportAddon" },
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

    if (sub.addons?.bmdExport?.active) {
      return { success: true };
    }

    // TODO: integrate Stripe subscription item for billing
    await subRef.update({
      "addons.bmdExport": {
        active: true,
        activatedAt: Timestamp.now(),
      },
      updatedAt: Timestamp.now(),
    });

    console.log(`[activateBmdExportAddon] Activated for user ${ctx.userId}`);
    return { success: true };
  }
);

export const deactivateBmdExportAddonCallable = createCallable<
  Record<string, never>,
  { success: boolean }
>(
  { name: "deactivateBmdExportAddon" },
  async (ctx) => {
    const subRef = ctx.db.collection("subscriptions").doc(ctx.userId);
    const subSnap = await subRef.get();

    if (!subSnap.exists) {
      throw new HttpsError("not-found", "No subscription found");
    }

    await subRef.update({
      "addons.bmdExport.active": false,
      updatedAt: Timestamp.now(),
    });

    console.log(`[deactivateBmdExportAddon] Deactivated for user ${ctx.userId}`);
    return { success: true };
  }
);
