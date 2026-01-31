"use strict";
/**
 * Callable Cloud Function for generating Gmail search queries
 * Uses Gemini Flash Lite for intelligent suggestions
 * Caches results on the transaction document for consistency between UI and Agent
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSearchQueriesCallable = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const crypto_1 = require("crypto");
const generateQueriesWithGemini_1 = require("./generateQueriesWithGemini");
const db = (0, firestore_1.getFirestore)();
/** Cache TTL in milliseconds (30 days) */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Generate a hash of partner data for cache invalidation.
 * When partner's emailDomains, aliases, or fileSourcePatterns change,
 * the hash will differ and trigger regeneration.
 */
function hashPartnerData(partner) {
    if (!partner)
        return "";
    const data = {
        name: partner.name || "",
        emailDomains: (partner.emailDomains || []).slice().sort(),
        aliases: (partner.aliases || []).slice().sort(),
        fileSourcePatterns: (partner.fileSourcePatterns || [])
            .map((p) => p.pattern)
            .sort(),
    };
    return (0, crypto_1.createHash)("md5").update(JSON.stringify(data)).digest("hex");
}
/**
 * Check if cached suggestions are still valid
 */
function isCacheValid(cached, currentPartnerId, currentPartnerHash) {
    // Check if partner changed
    if ((cached.partnerId || null) !== (currentPartnerId || null)) {
        return false;
    }
    // Check if partner data changed (emailDomains, aliases, etc.)
    if ((cached.partnerDataHash || "") !== currentPartnerHash) {
        return false;
    }
    // Check TTL
    const generatedAt = cached.generatedAt?.toMillis?.() || 0;
    if (Date.now() - generatedAt > CACHE_TTL_MS) {
        return false;
    }
    // Must have at least one suggestion
    if (!cached.suggestions || cached.suggestions.length === 0) {
        return false;
    }
    return true;
}
/**
 * Generate Gmail search queries for a transaction using Gemini
 * Caches results on the transaction document
 */
exports.generateSearchQueriesCallable = (0, https_1.onCall)({
    region: "europe-west1",
    memory: "256MiB",
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be authenticated");
    }
    const { transactionId, transaction, maxQueries = 8, forceRefresh = false } = request.data;
    if (!transaction || !transaction.name) {
        throw new https_1.HttpsError("invalid-argument", "Transaction with name is required");
    }
    // Fetch partner data if partnerId is provided
    let partnerData;
    if (transaction.partnerId) {
        const collection = transaction.partnerType === "global" ? "globalPartners" : "partners";
        const partnerDoc = await db.collection(collection).doc(transaction.partnerId).get();
        if (partnerDoc.exists) {
            const data = partnerDoc.data();
            partnerData = {
                name: data.name,
                emailDomains: data.emailDomains,
                website: data.website,
                ibans: data.ibans,
                vatId: data.vatId,
                aliases: data.aliases,
                fileSourcePatterns: data.fileSourcePatterns,
            };
        }
    }
    // Compute partner data hash for cache validation
    const partnerDataHash = hashPartnerData(partnerData);
    // Try to use cached suggestions if transactionId provided
    if (transactionId && !forceRefresh) {
        try {
            const txDoc = await db.collection("transactions").doc(transactionId).get();
            if (txDoc.exists) {
                const txData = txDoc.data();
                const cached = txData?.searchSuggestions;
                // Check if user owns this transaction
                if (txData?.userId !== request.auth.uid) {
                    throw new https_1.HttpsError("permission-denied", "Not authorized to access this transaction");
                }
                if (cached && isCacheValid(cached, transaction.partnerId, partnerDataHash)) {
                    // Cache hit - return cached suggestions
                    return {
                        queries: cached.suggestions.map((s) => s.query),
                        suggestions: cached.suggestions,
                        fromCache: true,
                    };
                }
            }
        }
        catch (error) {
            // If cache read fails, continue to generate new suggestions
            if (error?.code === "permission-denied") {
                throw error;
            }
            console.warn("[generateSearchQueriesCallable] Cache read failed:", error);
        }
    }
    // Generate typed suggestions using Gemini (sorted by search effectiveness)
    const suggestions = await (0, generateQueriesWithGemini_1.generateTypedQueriesWithGemini)({
        name: transaction.name,
        partner: transaction.partner,
        description: transaction.description,
        reference: transaction.reference,
        amount: transaction.amount,
    }, partnerData, maxQueries, request.auth.uid);
    // Save to cache if transactionId provided
    if (transactionId && suggestions.length > 0) {
        try {
            await db.collection("transactions").doc(transactionId).update({
                searchSuggestions: {
                    suggestions,
                    generatedAt: firestore_1.FieldValue.serverTimestamp(),
                    partnerId: transaction.partnerId || null,
                    partnerDataHash,
                },
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        catch (error) {
            // Cache write failure is not fatal - log and continue
            console.warn("[generateSearchQueriesCallable] Cache write failed:", error);
        }
    }
    // Also return plain queries for backward compatibility
    const queries = suggestions.map((s) => s.query);
    return {
        queries,
        suggestions,
        fromCache: false,
    };
});
//# sourceMappingURL=generateSearchQueriesCallable.js.map