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
exports.matchPartners = exports.AUTOMATION_META = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const matchCategories_1 = require("./matchCategories");
const partnerMatchingShared_1 = require("./partnerMatchingShared");
// =============================================================================
// AUTOMATION METADATA
// =============================================================================
exports.AUTOMATION_META = {
    id: "matchPartners",
    name: "Match Partners (Manual)",
    description: "Manually triggered partner matching for transactions. Matches by IBAN, name, and aliases; queues agentic search for uncertain matches.",
    trigger: {
        type: "callable",
        regions: ["europe-west1"],
    },
    effects: [
        {
            entity: "transaction",
            fields: [
                "partnerId",
                "partnerType",
                "partnerMatchedBy",
                "partnerMatchConfidence",
                "partnerSuggestions",
            ],
            action: "update",
        },
        {
            entity: "workerRequest",
            fields: ["workerType", "initialPrompt", "triggerContext"],
            action: "create",
        },
    ],
    config: {
        autoMatchThreshold: 89,
        maxSuggestions: 3,
    },
    icon: "Search",
    category: "matching",
};
// =============================================================================
// IMPLEMENTATION
// =============================================================================
const db = (0, firestore_1.getFirestore)();
/**
 * Queue an agentic partner search worker when rule-based matching finds suggestions
 * but no confident auto-match. The agent can search for company info, check VAT registries,
 * and make smarter partner assignments.
 */
async function queueAgenticPartnerSearch(userId, transactionId, transactionData, topSuggestionConfidence) {
    const promptParts = [
        `Find partner for transaction ID: ${transactionId}`,
    ];
    // Add transaction name if available (not included in ID line to keep prompt clean)
    if (transactionData.name) {
        promptParts.push(`Transaction name: "${transactionData.name}"`);
    }
    if (topSuggestionConfidence > 0) {
        promptParts.push(`Rule-based matching found suggestions but no confident match (top: ${topSuggestionConfidence}%)`);
    }
    else {
        promptParts.push(`Rule-based matching found no suggestions - search broadly`);
    }
    if (transactionData.partner) {
        promptParts.push(`Bank partner field: ${transactionData.partner}`);
    }
    if (transactionData.partnerIban) {
        promptParts.push(`IBAN: ${transactionData.partnerIban}`);
    }
    if (transactionData.reference) {
        promptParts.push(`Reference: ${transactionData.reference}`);
    }
    const initialPrompt = promptParts.join(". ");
    const requestId = await (0, partnerMatchingShared_1.queuePartnerMatchingWorker)(userId, initialPrompt, {
        transactionId,
        topSuggestionConfidence,
        triggeredAfterRuleBasedMatch: true,
    });
    console.log(`[PartnerMatch] Queued agentic search for transaction ${transactionId} (worker request ${requestId}, ` +
        `top suggestion: ${topSuggestionConfidence}%)`);
}
/**
 * Callable function to manually trigger partner matching
 * Can match specific transactions or all unmatched ones
 */
exports.matchPartners = (0, https_1.onCall)({
    region: "europe-west1",
    memory: "512MiB",
}, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const userId = request.auth.uid;
    const { transactionIds, matchAll } = request.data;
    console.log(`Manual matching triggered by user ${userId}`, { transactionIds, matchAll });
    const partnerContext = await (0, partnerMatchingShared_1.loadPartnerMatchingContext)(userId);
    // Get transactions to match
    let transactionsSnapshot;
    if (!matchAll && transactionIds && transactionIds.length > 0) {
        // Fetch specific transactions
        const docs = await Promise.all(transactionIds.map((id) => db.collection("transactions").doc(id).get()));
        transactionsSnapshot = docs.filter((doc) => doc.exists && doc.data()?.userId === userId);
    }
    else if (!matchAll) {
        // Only unmatched transactions
        const query = await db
            .collection("transactions")
            .where("userId", "==", userId)
            .where("partnerId", "==", null)
            .limit(1000)
            .get();
        transactionsSnapshot = query.docs;
    }
    else {
        // All transactions (force re-match)
        const query = await db
            .collection("transactions")
            .where("userId", "==", userId)
            .limit(1000)
            .get();
        transactionsSnapshot = query.docs;
    }
    const transactions = Array.isArray(transactionsSnapshot)
        ? transactionsSnapshot
        : transactionsSnapshot;
    const matchResult = await (0, partnerMatchingShared_1.processPartnerMatchesForTransactions)({
        userId,
        transactions,
        partnerContext,
        skipUnchangedSuggestions: true,
        collectAgenticFallback: true,
    });
    await (0, partnerMatchingShared_1.applyPartnerMatchUpdates)(matchResult.writeOperations);
    const { processed, autoMatched, withSuggestions, processedTransactionIds, autoMatchedPartnerIds, noAutoMatchTransactions, } = matchResult;
    console.log(`Matching complete: ${processed} processed, ${autoMatched} auto-matched, ${withSuggestions} new/updated suggestions`);
    // Create notification if there were results
    if (autoMatched > 0 || withSuggestions > 0) {
        try {
            await db.collection(`users/${userId}/notifications`).add({
                type: "partner_matching",
                title: autoMatched > 0
                    ? `Matched ${autoMatched} transaction${autoMatched !== 1 ? "s" : ""} automatically`
                    : `Found new suggestions for ${withSuggestions} transaction${withSuggestions !== 1 ? "s" : ""}`,
                message: autoMatched > 0
                    ? `I analyzed your transactions and automatically matched ${autoMatched} to known partners.${withSuggestions > 0 ? ` ${withSuggestions} more need your review.` : ""}`
                    : `I found new partner suggestions for ${withSuggestions} transaction${withSuggestions !== 1 ? "s" : ""}. Please review and confirm.`,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                readAt: null,
                context: {
                    autoMatchedCount: autoMatched,
                    suggestionsCount: withSuggestions,
                },
            });
        }
        catch (err) {
            console.error("Failed to create partner matching notification:", err);
        }
    }
    // Chain category matching after partner matching completes
    // Categories can use partnerId for 85% confidence matching
    if (processedTransactionIds.length > 0) {
        try {
            const categoryResult = await (0, matchCategories_1.matchCategoriesForTransactions)(userId, processedTransactionIds);
            console.log(`Category matching chained: ${categoryResult.autoMatched} auto-matched, ${categoryResult.withSuggestions} with suggestions`);
        }
        catch (err) {
            console.error("Failed to chain category matching:", err);
        }
    }
    // Chain file matching for auto-matched partners
    // This finds receipts/files for transactions that just got partner-matched
    if (autoMatchedPartnerIds.size > 0) {
        console.log(`Chaining file matching for ${autoMatchedPartnerIds.size} partners`);
        try {
            const { matchFilesForPartnerInternal } = await Promise.resolve().then(() => __importStar(require("./matchFilesForPartner")));
            for (const partnerId of autoMatchedPartnerIds) {
                try {
                    const fileResult = await matchFilesForPartnerInternal(userId, partnerId);
                    if (fileResult.autoMatched > 0 || fileResult.suggested > 0) {
                        console.log(`File matching for partner ${partnerId}: ${fileResult.autoMatched} auto-matched, ${fileResult.suggested} suggested`);
                    }
                }
                catch (err) {
                    console.error(`Failed to chain file matching for partner ${partnerId}:`, err);
                }
            }
        }
        catch (err) {
            console.error("Failed to import matchFilesForPartnerInternal:", err);
        }
    }
    // Queue agentic partner search for transactions with suggestions but no auto-match
    // Limit to 5 transactions to avoid flooding the worker queue
    if (noAutoMatchTransactions.length > 0 && noAutoMatchTransactions.length <= 5) {
        console.log(`Queueing agentic partner search for ${noAutoMatchTransactions.length} transactions without confident match`);
        for (const { id: txId, data: txData, topConfidence } of noAutoMatchTransactions) {
            try {
                await queueAgenticPartnerSearch(userId, txId, txData, topConfidence);
            }
            catch (err) {
                console.error(`Failed to queue agentic search for transaction ${txId}:`, err);
            }
        }
    }
    else if (noAutoMatchTransactions.length > 5) {
        console.log(`[PartnerMatch] ${noAutoMatchTransactions.length} transactions without confident match - ` +
            `skipping agentic fallback (batch too large, user should review manually)`);
    }
    return {
        processed,
        autoMatched,
        withSuggestions,
    };
});
//# sourceMappingURL=matchPartners.js.map