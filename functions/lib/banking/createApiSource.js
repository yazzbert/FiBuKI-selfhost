"use strict";
/**
 * Create an API-connected source (for banking integrations)
 *
 * Creates a source with apiConfig for finAPI or other banking providers.
 * Optionally triggers initial sync after creation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiSourceCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
/**
 * Normalize IBAN by removing spaces and converting to uppercase
 */
function normalizeIban(iban) {
    return iban.replace(/\s/g, "").toUpperCase();
}
exports.createApiSourceCallable = (0, createCallable_1.createCallable)({ name: "createApiSource" }, async (ctx, request) => {
    const { name, accountKind, iban, currency, apiConfig, connectionId } = request;
    // Validate required fields
    if (!name?.trim()) {
        throw new createCallable_1.HttpsError("invalid-argument", "Source name is required");
    }
    if (!currency) {
        throw new createCallable_1.HttpsError("invalid-argument", "Currency is required");
    }
    if (!apiConfig || !apiConfig.provider) {
        throw new createCallable_1.HttpsError("invalid-argument", "apiConfig with provider is required");
    }
    // Check for existing source with same accountId (prevent duplicates)
    if (apiConfig.accountId) {
        const existingQuery = await ctx.db
            .collection("sources")
            .where("userId", "==", ctx.userId)
            .where("apiConfig.accountId", "==", apiConfig.accountId)
            .limit(1)
            .get();
        if (!existingQuery.empty) {
            throw new createCallable_1.HttpsError("already-exists", "This account is already connected", { sourceId: existingQuery.docs[0].id });
        }
    }
    const now = firestore_1.Timestamp.now();
    // Prepare apiConfig with proper timestamp handling
    const preparedApiConfig = {
        ...apiConfig,
    };
    // Convert date strings to Timestamps
    if (apiConfig.tokenExpiresAt) {
        preparedApiConfig.tokenExpiresAt = apiConfig.tokenExpiresAt instanceof Date
            ? firestore_1.Timestamp.fromDate(apiConfig.tokenExpiresAt)
            : firestore_1.Timestamp.fromDate(new Date(apiConfig.tokenExpiresAt));
    }
    if (apiConfig.expiresAt) {
        preparedApiConfig.expiresAt = apiConfig.expiresAt instanceof Date
            ? firestore_1.Timestamp.fromDate(apiConfig.expiresAt)
            : firestore_1.Timestamp.fromDate(new Date(apiConfig.expiresAt));
    }
    if (apiConfig.lastSyncAt === null) {
        preparedApiConfig.lastSyncAt = null;
    }
    const sourceData = {
        name: name.trim(),
        accountKind: accountKind || "bank_account",
        iban: iban ? normalizeIban(iban) : null,
        currency,
        type: "api",
        apiConfig: preparedApiConfig,
        isActive: true,
        userId: ctx.userId,
        createdAt: now,
        updatedAt: now,
    };
    const docRef = await ctx.db.collection("sources").add(sourceData);
    const sourceId = docRef.id;
    console.log(`[createApiSource] Created source ${sourceId}`, {
        userId: ctx.userId,
        provider: apiConfig.provider,
        accountId: apiConfig.accountId,
    });
    // If connectionId provided, update the connection to link it
    if (connectionId) {
        try {
            await ctx.db.collection("bankingConnections").doc(connectionId).update({
                linkedSourceId: sourceId,
                updatedAt: now,
            });
            console.log(`[createApiSource] Linked to connection ${connectionId}`);
        }
        catch (err) {
            // Non-fatal - connection might not exist
            console.warn(`[createApiSource] Failed to link to connection ${connectionId}:`, err);
        }
    }
    return {
        success: true,
        sourceId,
    };
});
//# sourceMappingURL=createApiSource.js.map