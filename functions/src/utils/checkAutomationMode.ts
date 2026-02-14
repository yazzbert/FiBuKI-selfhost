/**
 * Automation Mode Guard
 *
 * Checks a user's automation mode (active vs passive).
 * In passive mode, AI-powered steps are skipped while deterministic
 * matching and scoring still run.
 */

import { getFirestore } from "firebase-admin/firestore";

export type AutomationMode = "active" | "passive";

const db = getFirestore();

/**
 * Get the user's automation mode from their subscription.
 * Defaults to "active" if not set.
 */
export async function getAutomationMode(userId: string): Promise<AutomationMode> {
  const subDoc = await db.collection("subscriptions").doc(userId).get();
  if (!subDoc.exists) return "active";
  return (subDoc.data()?.automationMode as AutomationMode) || "active";
}

/**
 * Check if user is in passive mode.
 */
export async function isPassiveMode(userId: string): Promise<boolean> {
  return (await getAutomationMode(userId)) === "passive";
}
