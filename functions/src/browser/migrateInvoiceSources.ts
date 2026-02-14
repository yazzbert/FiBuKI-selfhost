/**
 * One-shot migration callable: converts InvoiceSources → BrowserRecipes.
 * For each partner with invoiceSources[], each source becomes a BrowserRecipe
 * with empty recordedActions (a "bookmark" — same URL, no navigation steps).
 * Skips sources whose domain already has a recipe. Clears invoiceSources after migration.
 */

import { createCallable } from "../utils/createCallable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

interface MigrateInvoiceSourcesRequest {
  /** Optional: only migrate a specific partner. If omitted, migrates all. */
  partnerId?: string;
}

interface MigrateInvoiceSourcesResponse {
  success: boolean;
  migratedPartners: number;
  migratedSources: number;
  skippedSources: number;
}

interface InvoiceSourceDoc {
  id: string;
  url: string;
  domain: string;
  label?: string;
  sourceType: string;
  fromInvoiceLinkMessageId?: string;
  inferredFrequencyDays?: number;
  frequencySource?: string;
  frequencyDataPoints?: number;
  lastFetchedAt?: FirebaseFirestore.Timestamp;
  nextExpectedAt?: FirebaseFirestore.Timestamp;
  successfulFetches: number;
  failedFetches: number;
  status: string;
  lastError?: string;
  discoveredAt?: FirebaseFirestore.Timestamp;
  statusChangedAt?: FirebaseFirestore.Timestamp;
}

export const migrateInvoiceSourcesCallable = createCallable<
  MigrateInvoiceSourcesRequest,
  MigrateInvoiceSourcesResponse
>(
  { name: "migrateInvoiceSources" },
  async (ctx, request) => {
    const { partnerId } = request;

    let partnersQuery: FirebaseFirestore.Query;
    if (partnerId) {
      // Migrate a specific partner
      partnersQuery = ctx.db
        .collection("partners")
        .where("userId", "==", ctx.userId)
        .where("__name__", "==", partnerId);
    } else {
      // Migrate all partners for this user
      partnersQuery = ctx.db
        .collection("partners")
        .where("userId", "==", ctx.userId);
    }

    const partnersSnap = await partnersQuery.get();
    let migratedPartners = 0;
    let migratedSources = 0;
    let skippedSources = 0;

    for (const partnerDoc of partnersSnap.docs) {
      const data = partnerDoc.data();
      const invoiceSources: InvoiceSourceDoc[] = data.invoiceSources || [];
      if (invoiceSources.length === 0) continue;

      const existingRecipes: Array<{ domain: string; id: string }> =
        data.browserRecipes || [];
      const existingDomains = new Set(existingRecipes.map((r) => r.domain));

      const newRecipes: Record<string, unknown>[] = [...existingRecipes];
      let partnerMigrated = 0;

      for (const source of invoiceSources) {
        // Skip if a recipe for this domain already exists
        if (existingDomains.has(source.domain)) {
          skippedSources++;
          continue;
        }

        const now = Timestamp.now();
        const recipeId = `recipe_${source.domain.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${partnerMigrated}`;

        const recipe: Record<string, unknown> = {
          id: recipeId,
          startUrl: source.url,
          domain: source.domain,
          recordedActions: [], // Bookmark — no navigation steps
          requiresAuth: false,
          useCount: source.successfulFetches || 0,
          autoRun: false,
          status: source.status || "active",
          successfulFetches: source.successfulFetches || 0,
          failedFetches: source.failedFetches || 0,
          createdAt: source.discoveredAt || now,
          updatedAt: now,
        };

        if (source.label) recipe.label = source.label;
        if (source.sourceType) recipe.sourceType = source.sourceType;
        if (source.fromInvoiceLinkMessageId) {
          recipe.fromInvoiceLinkMessageId = source.fromInvoiceLinkMessageId;
        }
        if (source.inferredFrequencyDays) {
          recipe.inferredFrequencyDays = source.inferredFrequencyDays;
        }
        if (source.frequencySource) {
          recipe.frequencySource = source.frequencySource;
        }
        if (source.frequencyDataPoints) {
          recipe.frequencyDataPoints = source.frequencyDataPoints;
        }
        if (source.nextExpectedAt) {
          recipe.nextExpectedAt = source.nextExpectedAt;
        }
        if (source.lastFetchedAt) {
          recipe.lastUsedAt = source.lastFetchedAt;
        }
        if (source.lastError) {
          recipe.lastError = source.lastError;
        }

        newRecipes.push(recipe);
        existingDomains.add(source.domain);
        partnerMigrated++;
        migratedSources++;
      }

      if (partnerMigrated > 0) {
        // Cap at 20 recipes
        const cappedRecipes = newRecipes.slice(0, 20);

        await partnerDoc.ref.update({
          browserRecipes: cappedRecipes,
          invoiceSources: FieldValue.delete(),
          invoiceSourcesUpdatedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        migratedPartners++;
      }
    }

    return {
      success: true,
      migratedPartners,
      migratedSources,
      skippedSources,
    };
  }
);
