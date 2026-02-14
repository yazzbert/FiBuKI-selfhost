/**
 * Delete a browser recipe from a partner.
 * Removes the recipe from the partner's browserRecipes[] array.
 */

import { createCallable, HttpsError } from "../utils/createCallable";
import { FieldValue } from "firebase-admin/firestore";

interface DeleteBrowserRecipeRequest {
  partnerId: string;
  recipeId: string;
}

interface DeleteBrowserRecipeResponse {
  success: boolean;
}

export const deleteBrowserRecipeCallable = createCallable<
  DeleteBrowserRecipeRequest,
  DeleteBrowserRecipeResponse
>(
  { name: "deleteBrowserRecipe" },
  async (ctx, request) => {
    const { partnerId, recipeId } = request;

    if (!partnerId) {
      throw new HttpsError("invalid-argument", "partnerId is required");
    }
    if (!recipeId) {
      throw new HttpsError("invalid-argument", "recipeId is required");
    }

    const partnerRef = ctx.db.collection("partners").doc(partnerId);
    const partnerDoc = await partnerRef.get();

    if (!partnerDoc.exists) {
      throw new HttpsError("not-found", "Partner not found");
    }
    if (partnerDoc.data()?.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Partner belongs to a different user");
    }

    const existingRecipes: Array<Record<string, unknown>> = partnerDoc.data()?.browserRecipes || [];
    const filtered = existingRecipes.filter((r) => r.id !== recipeId);

    if (filtered.length === existingRecipes.length) {
      throw new HttpsError("not-found", "Recipe not found");
    }

    await partnerRef.update({
      browserRecipes: filtered,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);
