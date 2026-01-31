"use strict";
/**
 * Create a new banking connection
 *
 * Called when a user initiates a bank connection through finAPI or other provider.
 * Stores the connection metadata and auth URL for the user to complete.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBankingConnectionCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
exports.createBankingConnectionCallable = (0, createCallable_1.createCallable)({ name: "createBankingConnection" }, async (ctx, request) => {
    const { providerId, providerConnectionId, institutionId, institutionName, institutionLogo, authUrl, expiresAt, providerData, linkToSourceId, } = request;
    // Validate required fields
    if (!providerId) {
        throw new createCallable_1.HttpsError("invalid-argument", "providerId is required");
    }
    if (!providerConnectionId) {
        throw new createCallable_1.HttpsError("invalid-argument", "providerConnectionId is required");
    }
    if (!institutionId) {
        throw new createCallable_1.HttpsError("invalid-argument", "institutionId is required");
    }
    if (!institutionName) {
        throw new createCallable_1.HttpsError("invalid-argument", "institutionName is required");
    }
    if (!authUrl) {
        throw new createCallable_1.HttpsError("invalid-argument", "authUrl is required");
    }
    if (!expiresAt) {
        throw new createCallable_1.HttpsError("invalid-argument", "expiresAt is required");
    }
    const now = firestore_1.Timestamp.now();
    const connectionDoc = {
        providerId,
        providerConnectionId,
        institutionId,
        institutionName,
        institutionLogo: institutionLogo || null,
        status: "pending",
        authUrl,
        accountIds: [],
        expiresAt: firestore_1.Timestamp.fromDate(new Date(expiresAt)),
        providerData: providerData || {},
        linkToSourceId: linkToSourceId || null,
        userId: ctx.userId,
        createdAt: now,
        updatedAt: now,
    };
    const docRef = await ctx.db.collection("bankingConnections").add(connectionDoc);
    console.log(`[createBankingConnection] Created connection ${docRef.id}`, {
        userId: ctx.userId,
        providerId,
        institutionId,
    });
    return {
        success: true,
        connectionId: docRef.id,
        authUrl,
        expiresAt,
    };
});
//# sourceMappingURL=createBankingConnection.js.map