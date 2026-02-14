"use strict";
/**
 * Update a single transaction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTransactionCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const activityLevel_1 = require("../utils/activityLevel");
exports.updateTransactionCallable = (0, createCallable_1.createCallable)({ name: "updateTransaction" }, async (ctx, request) => {
    const { id, data } = request;
    if (!id) {
        throw new createCallable_1.HttpsError("invalid-argument", "Transaction ID is required");
    }
    // Verify ownership
    const transactionRef = ctx.db.collection("transactions").doc(id);
    const transactionSnap = await transactionRef.get();
    if (!transactionSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Transaction not found");
    }
    const transactionData = transactionSnap.data();
    if (transactionData?.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    // Build update object, filtering out undefined values
    const updateData = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            updateData[key] = value;
        }
    }
    // Automatically manage isComplete based on noReceiptCategoryId changes
    // Green row = file attached OR no-receipt category assigned
    if (data.noReceiptCategoryId !== undefined) {
        const currentFileIds = transactionData?.fileIds || [];
        const hasFiles = currentFileIds.length > 0;
        if (data.noReceiptCategoryId) {
            // Category being assigned -> mark complete
            updateData.isComplete = true;
        }
        else if (!hasFiles) {
            // Category being removed AND no files -> mark incomplete
            updateData.isComplete = false;
        }
        // If category removed but has files, keep isComplete=true (don't change)
    }
    // Log category changes to activity log
    if (data.noReceiptCategoryId !== undefined) {
        const previousCategoryId = transactionData?.noReceiptCategoryId;
        const actor = (data.noReceiptCategoryMatchedBy === "suggestion" ? "suggestion" : data.noReceiptCategoryMatchedBy === "auto" ? "auto" : "manual");
        if (data.noReceiptCategoryId && data.noReceiptCategoryId !== previousCategoryId) {
            // Look up category name
            let categoryName = null;
            try {
                const catSnap = await ctx.db.collection("noReceiptCategories").doc(data.noReceiptCategoryId).get();
                categoryName = catSnap.data()?.name || null;
            }
            catch { /* best effort */ }
            updateData.automationHistory = firestore_1.FieldValue.arrayUnion({
                type: "category_assigned",
                ranAt: firestore_1.Timestamp.now(),
                status: "completed",
                actor,
                level: (0, activityLevel_1.deriveActivityLevel)({ type: "category_assigned", actor }),
                categoryName: categoryName || data.noReceiptCategoryTemplateId || null,
                confidence: data.noReceiptCategoryConfidence ?? null,
                summary: `Category "${categoryName || data.noReceiptCategoryTemplateId || "unknown"}" assigned`,
            });
        }
        else if (!data.noReceiptCategoryId && previousCategoryId) {
            // Look up previous category name
            let categoryName = null;
            try {
                const catSnap = await ctx.db.collection("noReceiptCategories").doc(previousCategoryId).get();
                categoryName = catSnap.data()?.name || null;
            }
            catch { /* best effort */ }
            updateData.automationHistory = firestore_1.FieldValue.arrayUnion({
                type: "category_removed",
                ranAt: firestore_1.Timestamp.now(),
                status: "completed",
                actor: "manual",
                level: "decision",
                categoryName: categoryName || null,
                summary: `Category "${categoryName || "unknown"}" removed`,
            });
        }
    }
    // Always update timestamp
    updateData.updatedAt = firestore_1.FieldValue.serverTimestamp();
    await transactionRef.update(updateData);
    console.log(`[updateTransaction] Updated transaction ${id}`, {
        userId: ctx.userId,
        fields: Object.keys(updateData),
    });
    return { success: true };
});
//# sourceMappingURL=updateTransaction.js.map