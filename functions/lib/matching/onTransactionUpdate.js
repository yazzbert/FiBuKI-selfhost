"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTransactionUpdate = exports.AUTOMATION_META = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const category_matcher_1 = require("../utils/category-matcher");
const checkAutomationMode_1 = require("../utils/checkAutomationMode");
// =============================================================================
// AUTOMATION METADATA
// =============================================================================
exports.AUTOMATION_META = {
    id: "onTransactionUpdate",
    name: "Transaction Update Handler",
    description: "Syncs isComplete flag, learns resolution preferences, and triggers category matching on partner assignment",
    trigger: {
        type: "document_update",
        collection: "transactions",
    },
    effects: [
        {
            entity: "transaction",
            fields: [
                "isComplete",
                "noReceiptCategoryId",
                "noReceiptCategoryTemplateId",
                "noReceiptCategoryConfidence",
                "noReceiptCategoryMatchedBy",
                "categorySuggestions",
            ],
            action: "update",
        },
        {
            entity: "partner",
            fields: ["resolutionPreference"],
            action: "update",
        },
        {
            entity: "noReceiptCategory",
            fields: ["matchedPartnerIds"],
            action: "update",
        },
        {
            entity: "workerRequest",
            fields: ["workerType", "initialPrompt"],
            action: "create",
        },
    ],
    learns: [
        {
            entity: "partner",
            fields: ["resolutionPreference"],
            description: "Tracks file vs no-receipt resolution patterns to predict future behavior",
        },
    ],
    config: {
        categoryAutoApplyThreshold: 89,
    },
    icon: "Zap",
    category: "sync",
};
// =============================================================================
// IMPLEMENTATION
// =============================================================================
const db = (0, firestore_2.getFirestore)();
/**
 * Triggered when a transaction is updated.
 *
 * Handles:
 * 1. isComplete sync - keeps flag in sync with fileIds/noReceiptCategoryId
 * 2. Partner automations - triggers receipt search and category matching
 */
exports.onTransactionUpdate = (0, firestore_1.onDocumentUpdated)({
    document: "transactions/{transactionId}",
    region: "europe-west1",
}, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const transactionId = event.params.transactionId;
    if (!before || !after)
        return;
    // === SYNC isComplete FLAG ===
    // isComplete = true when: fileIds.length > 0 OR noReceiptCategoryId is set
    const fileIdsChanged = JSON.stringify(before.fileIds) !== JSON.stringify(after.fileIds);
    const categoryChanged = before.noReceiptCategoryId !== after.noReceiptCategoryId;
    if (fileIdsChanged || categoryChanged) {
        const hasFiles = (after.fileIds?.length ?? 0) > 0;
        const hasCategory = !!after.noReceiptCategoryId;
        const shouldBeComplete = hasFiles || hasCategory;
        if (after.isComplete !== shouldBeComplete) {
            await event.data.after.ref.update({
                isComplete: shouldBeComplete,
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            });
            console.log(`[onTransactionUpdate] Synced isComplete=${shouldBeComplete} for ${transactionId}`);
            // Return early - the update will trigger this function again with correct isComplete
            return;
        }
    }
    // === END isComplete SYNC ===
    // === LEARN RESOLUTION PREFERENCE ===
    // When transaction is marked complete, update partner's resolution preference
    const wasCompleted = !before.isComplete && after.isComplete;
    const completionPartnerId = after.partnerId;
    if (wasCompleted && completionPartnerId && after.partnerType === "user") {
        const completionHasFiles = (after.fileIds?.length ?? 0) > 0;
        const completionHasCategory = !!after.noReceiptCategoryId;
        // Only learn if exactly one resolution method (not both)
        // This avoids double-counting edge cases
        if ((completionHasFiles && !completionHasCategory) ||
            (!completionHasFiles && completionHasCategory)) {
            try {
                const { updatePartnerResolutionStats } = await Promise.resolve().then(() => __importStar(require("./learnPartnerResolution")));
                await updatePartnerResolutionStats(after.userId, completionPartnerId, completionHasFiles ? "file" : "no_receipt", after.noReceiptCategoryId || null);
            }
            catch (err) {
                console.error(`[onTransactionUpdate] Failed to update resolution stats:`, err);
            }
        }
    }
    // === END RESOLUTION LEARNING ===
    // === PARTNER CHANGE AUTOMATIONS ===
    // Only trigger when partnerId is newly assigned (was null, now has value)
    // OR when partnerId changed to a different partner
    const partnerWasAssigned = !before.partnerId && after.partnerId;
    const partnerChanged = before.partnerId !== after.partnerId && after.partnerId;
    if (!partnerWasAssigned && !partnerChanged) {
        return;
    }
    // Skip automations for auto-matched transactions — pattern learning pipeline
    // (rematchUnassignedTransactions) handles these in bulk. Running receipt search
    // and category matching for each auto-assigned tx would create N redundant invocations.
    if (after.partnerMatchedBy === "auto") {
        console.log(`[onTransactionUpdate] Skipping automations for auto-matched tx ${transactionId}`);
        return;
    }
    const userId = after.userId;
    const hasFiles = after.fileIds && after.fileIds.length > 0;
    const hasCategory = !!after.noReceiptCategoryId;
    console.log(`Partner ${after.partnerId} assigned to transaction ${transactionId}, triggering automations`);
    // Fetch partner doc once — reused by reconciliation check + category matching
    let partnerDoc = null;
    try {
        partnerDoc = await db.collection("partners").doc(after.partnerId).get();
    }
    catch (err) {
        console.error(`[onTransactionUpdate] Failed to fetch partner ${after.partnerId}:`, err);
    }
    // === RECONCILIATION CHECK ===
    // When a source partner is assigned, check if this bank tx pays a linked card
    if (partnerDoc?.exists) {
        const identitySourceField = partnerDoc.data().identitySourceField;
        if (identitySourceField?.startsWith("source:")) {
            const cardSourceId = identitySourceField.replace("source:", "");
            console.log(`[onTransactionUpdate] Source partner detected for tx ${transactionId}, ` +
                `checking reconciliation with card source ${cardSourceId}`);
            // Fire-and-forget reconciliation (don't block other automations)
            Promise.resolve().then(() => __importStar(require("../reconciliation/processReconciliation"))).then(({ tryReconcileTransaction }) => tryReconcileTransaction(userId, transactionId, {
                amount: after.amount,
                date: after.date,
                name: after.name || "",
                sourceId: after.sourceId,
                noReceiptCategoryTemplateId: after.noReceiptCategoryTemplateId || null,
                partnerId: after.partnerId || null,
            }, cardSourceId))
                .then(() => {
                console.log(`[onTransactionUpdate] Reconciliation check complete for ${transactionId}`);
            })
                .catch((err) => {
                console.error(`[onTransactionUpdate] Reconciliation check failed:`, err);
            });
        }
    }
    // === END RECONCILIATION CHECK ===
    // Queue receipt search if transaction has no files AND no no-receipt category
    // Transactions with a no-receipt category are considered complete
    // Skip in passive mode (AI-powered search is opt-in only)
    if (!hasFiles && !hasCategory) {
        const passive = await (0, checkAutomationMode_1.isPassiveMode)(userId);
        if (passive) {
            console.log(`[onTransactionUpdate] Passive mode — skipping receipt search for ${transactionId}`);
        }
        else {
            try {
                const { queueReceiptSearchForTransaction } = await Promise.resolve().then(() => __importStar(require("../workers/runReceiptSearchForTransaction")));
                queueReceiptSearchForTransaction({
                    transactionId,
                    userId,
                    partnerId: after.partnerId,
                })
                    .then((result) => {
                    if (result.skipped) {
                        console.log(`[onTransactionUpdate] Receipt search skipped: ${result.skipReason}`);
                    }
                    else {
                        console.log(`[onTransactionUpdate] Receipt search queued for ${transactionId}`);
                    }
                })
                    .catch((err) => {
                    console.error(`[onTransactionUpdate] Failed to queue receipt search:`, err);
                });
            }
            catch (err) {
                console.error(`[onTransactionUpdate] Failed to import receipt search module:`, err);
            }
        }
    }
    // Skip category matching if already has category or files
    if (hasCategory || hasFiles) {
        return;
    }
    try {
        // Get all active categories for this user
        const categoriesSnapshot = await db
            .collection("noReceiptCategories")
            .where("userId", "==", userId)
            .where("isActive", "==", true)
            .get();
        if (categoriesSnapshot.empty) {
            console.log(`No active categories found for user ${userId}`);
            return;
        }
        // Build map of categoryId -> Set<transactionIds> for manual removals
        const categoryManualRemovals = new Map();
        const categories = categoriesSnapshot.docs.map((doc) => {
            const data = doc.data();
            const removals = data.manualRemovals || [];
            if (removals.length > 0) {
                categoryManualRemovals.set(doc.id, new Set(removals.map((r) => r.transactionId)));
            }
            return {
                id: doc.id,
                userId: data.userId,
                templateId: data.templateId,
                name: data.name,
                matchedPartnerIds: data.matchedPartnerIds || [],
                learnedPatterns: data.learnedPatterns || [],
                manualRemovals: removals,
                transactionCount: data.transactionCount || 0,
                isActive: data.isActive,
            };
        });
        // Build transaction data for matching
        const transaction = {
            id: transactionId,
            partner: after.partner || null,
            partnerId: after.partnerId || null,
            name: after.name || "",
            reference: after.reference || null,
            noReceiptCategoryId: after.noReceiptCategoryId || null,
            fileIds: after.fileIds || [],
        };
        if (!(0, category_matcher_1.isEligibleForCategoryMatching)(transaction)) {
            return;
        }
        // Use partner's category match rules (from already-fetched partnerDoc)
        const options = {};
        if (partnerDoc?.exists) {
            const partnerData = partnerDoc.data();
            if (partnerData?.categoryMatchRules && partnerData.categoryMatchRules.length > 0) {
                options.partnerCategoryRules = partnerData.categoryMatchRules;
                console.log(`Loaded ${options.partnerCategoryRules.length} category rules for partner ${after.partnerId}`);
            }
        }
        // Match transaction to categories
        const matches = (0, category_matcher_1.matchTransactionToCategories)(transaction, categories, categoryManualRemovals, options);
        if (matches.length > 0) {
            const topMatch = matches[0];
            const updates = {
                categorySuggestions: matches.map((m) => ({
                    categoryId: m.categoryId,
                    templateId: m.templateId,
                    confidence: m.confidence,
                    source: m.source,
                })),
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            };
            if ((0, category_matcher_1.shouldAutoApplyCategory)(topMatch.confidence)) {
                updates.noReceiptCategoryId = topMatch.categoryId;
                updates.noReceiptCategoryTemplateId = topMatch.templateId;
                updates.noReceiptCategoryConfidence = topMatch.confidence;
                updates.noReceiptCategoryMatchedBy = "auto";
                updates.isComplete = true;
                // Also link partner to category
                const category = categories.find((c) => c.id === topMatch.categoryId);
                if (category && after.partnerId && !category.matchedPartnerIds.includes(after.partnerId)) {
                    await db.collection("noReceiptCategories").doc(topMatch.categoryId).update({
                        matchedPartnerIds: firestore_2.FieldValue.arrayUnion(after.partnerId),
                        updatedAt: firestore_2.FieldValue.serverTimestamp(),
                    });
                    console.log(`Linked partner ${after.partnerId} to category ${topMatch.templateId}`);
                }
                // Log category auto-match to activity log
                updates.automationHistory = firestore_2.FieldValue.arrayUnion({
                    type: "category_matched",
                    ranAt: firestore_2.Timestamp.now(),
                    status: "completed",
                    actor: "auto",
                    level: "outcome",
                    categoryName: topMatch.templateId,
                    confidence: topMatch.confidence,
                    summary: `Category "${topMatch.templateId}" auto-assigned (${topMatch.confidence}%)`,
                });
                console.log(`Auto-matched transaction ${transactionId} to category ${topMatch.templateId} (${topMatch.confidence}%)`);
            }
            else {
                console.log(`Added ${matches.length} category suggestions to transaction ${transactionId}`);
            }
            await db.collection("transactions").doc(transactionId).update(updates);
        }
    }
    catch (error) {
        console.error(`Error re-matching categories for transaction ${transactionId}:`, error);
    }
});
//# sourceMappingURL=onTransactionUpdate.js.map