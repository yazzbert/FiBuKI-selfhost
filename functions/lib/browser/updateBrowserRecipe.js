"use strict";
/**
 * Update a browser recipe after a replay attempt.
 * Updates: lastReplayResult, agentActions, useCount, lastUsedAt/lastFailedAt, invoiceTableMeta.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBrowserRecipeCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
exports.updateBrowserRecipeCallable = (0, createCallable_1.createCallable)({ name: "updateBrowserRecipe" }, async (ctx, request) => {
    const { partnerId, recipeId, lastReplayResult, agentActions, invoiceTableMeta, incrementUseCount, autoRun, label } = request;
    if (!partnerId) {
        throw new createCallable_1.HttpsError("invalid-argument", "partnerId is required");
    }
    if (!recipeId) {
        throw new createCallable_1.HttpsError("invalid-argument", "recipeId is required");
    }
    // Verify partner belongs to user
    const partnerRef = ctx.db.collection("partners").doc(partnerId);
    const partnerDoc = await partnerRef.get();
    if (!partnerDoc.exists) {
        throw new createCallable_1.HttpsError("not-found", "Partner not found");
    }
    if (partnerDoc.data()?.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Partner belongs to a different user");
    }
    const existingRecipes = partnerDoc.data()?.browserRecipes || [];
    const recipeIndex = existingRecipes.findIndex((r) => r.id === recipeId);
    if (recipeIndex < 0) {
        throw new createCallable_1.HttpsError("not-found", "Recipe not found");
    }
    const recipe = existingRecipes[recipeIndex];
    const now = firestore_1.Timestamp.now();
    // Update lastReplayResult
    if (lastReplayResult) {
        recipe.lastReplayResult = {
            ...lastReplayResult,
            timestamp: now,
        };
        // Update lastUsedAt / lastFailedAt
        if (lastReplayResult.status === "success") {
            recipe.lastUsedAt = now;
        }
        else {
            recipe.lastFailedAt = now;
        }
    }
    // Update agentActions (append new agent-learned actions)
    if (agentActions && agentActions.length > 0) {
        const cleanActions = agentActions.slice(0, 50).map((a) => JSON.parse(JSON.stringify(a)));
        // Mark all as agent-sourced
        for (const action of cleanActions) {
            action.source = "agent";
        }
        recipe.agentActions = cleanActions;
    }
    // Update invoiceTableMeta
    if (invoiceTableMeta) {
        recipe.invoiceTableMeta = JSON.parse(JSON.stringify(invoiceTableMeta));
    }
    // Increment use count
    if (incrementUseCount) {
        recipe.useCount = (recipe.useCount || 0) + 1;
    }
    // Update autoRun flag
    if (typeof autoRun === "boolean") {
        recipe.autoRun = autoRun;
    }
    // Update label
    if (typeof label === "string") {
        recipe.label = label || null;
    }
    // Update status
    if (request.status) {
        recipe.status = request.status;
    }
    // Update frequency fields
    if (typeof request.inferredFrequencyDays === "number") {
        recipe.inferredFrequencyDays = request.inferredFrequencyDays;
    }
    if (request.frequencySource) {
        recipe.frequencySource = request.frequencySource;
    }
    if (typeof request.frequencyDataPoints === "number") {
        recipe.frequencyDataPoints = request.frequencyDataPoints;
    }
    if (request.nextExpectedAt) {
        recipe.nextExpectedAt = firestore_1.Timestamp.fromDate(new Date(request.nextExpectedAt));
    }
    // Update error
    if (request.lastError === null) {
        delete recipe.lastError;
    }
    else if (typeof request.lastError === "string") {
        recipe.lastError = request.lastError;
    }
    // Increment fetch counters
    if (request.incrementSuccessfulFetches) {
        recipe.successfulFetches = (recipe.successfulFetches || 0) + 1;
    }
    if (request.incrementFailedFetches) {
        recipe.failedFetches = (recipe.failedFetches || 0) + 1;
    }
    recipe.updatedAt = now;
    // Write back
    existingRecipes[recipeIndex] = recipe;
    await partnerRef.update({
        browserRecipes: existingRecipes,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { success: true };
});
//# sourceMappingURL=updateBrowserRecipe.js.map