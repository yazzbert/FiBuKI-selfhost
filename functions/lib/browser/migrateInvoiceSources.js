"use strict";
/**
 * One-shot migration callable: converts InvoiceSources → BrowserRecipes.
 * For each partner with invoiceSources[], each source becomes a BrowserRecipe
 * with empty recordedActions (a "bookmark" — same URL, no navigation steps).
 * Skips sources whose domain already has a recipe. Clears invoiceSources after migration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateInvoiceSourcesCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
exports.migrateInvoiceSourcesCallable = (0, createCallable_1.createCallable)({ name: "migrateInvoiceSources" }, async (ctx, request) => {
    const { partnerId } = request;
    let partnersQuery;
    if (partnerId) {
        // Migrate a specific partner
        partnersQuery = ctx.db
            .collection("partners")
            .where("userId", "==", ctx.userId)
            .where("__name__", "==", partnerId);
    }
    else {
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
        const invoiceSources = data.invoiceSources || [];
        if (invoiceSources.length === 0)
            continue;
        const existingRecipes = data.browserRecipes || [];
        const existingDomains = new Set(existingRecipes.map((r) => r.domain));
        const newRecipes = [...existingRecipes];
        let partnerMigrated = 0;
        for (const source of invoiceSources) {
            // Skip if a recipe for this domain already exists
            if (existingDomains.has(source.domain)) {
                skippedSources++;
                continue;
            }
            const now = firestore_1.Timestamp.now();
            const recipeId = `recipe_${source.domain.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${partnerMigrated}`;
            const recipe = {
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
            if (source.label)
                recipe.label = source.label;
            if (source.sourceType)
                recipe.sourceType = source.sourceType;
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
                invoiceSources: firestore_1.FieldValue.delete(),
                invoiceSourcesUpdatedAt: firestore_1.FieldValue.delete(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
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
});
//# sourceMappingURL=migrateInvoiceSources.js.map