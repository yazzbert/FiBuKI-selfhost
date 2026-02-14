"use strict";
/**
 * Delete a browser recipe from a partner.
 * Removes the recipe from the partner's browserRecipes[] array.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBrowserRecipeCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
exports.deleteBrowserRecipeCallable = (0, createCallable_1.createCallable)({ name: "deleteBrowserRecipe" }, async (ctx, request) => {
    const { partnerId, recipeId } = request;
    if (!partnerId) {
        throw new createCallable_1.HttpsError("invalid-argument", "partnerId is required");
    }
    if (!recipeId) {
        throw new createCallable_1.HttpsError("invalid-argument", "recipeId is required");
    }
    const partnerRef = ctx.db.collection("partners").doc(partnerId);
    const partnerDoc = await partnerRef.get();
    if (!partnerDoc.exists) {
        throw new createCallable_1.HttpsError("not-found", "Partner not found");
    }
    if (partnerDoc.data()?.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Partner belongs to a different user");
    }
    const existingRecipes = partnerDoc.data()?.browserRecipes || [];
    const filtered = existingRecipes.filter((r) => r.id !== recipeId);
    if (filtered.length === existingRecipes.length) {
        throw new createCallable_1.HttpsError("not-found", "Recipe not found");
    }
    await partnerRef.update({
        browserRecipes: filtered,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { success: true };
});
//# sourceMappingURL=deleteBrowserRecipe.js.map