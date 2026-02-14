"use strict";
/**
 * Delete a source and all associated imports/transactions (cascade delete)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSourceCallable = void 0;
exports.deleteSourceInternal = deleteSourceInternal;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const BATCH_SIZE = 500;
/**
 * Internal implementation for deleting a source.
 * Can be called directly from MCP handlers.
 */
async function deleteSourceInternal(dbRef, userId, sourceId) {
    if (!sourceId) {
        throw new createCallable_1.HttpsError("invalid-argument", "sourceId is required");
    }
    // Verify ownership
    const sourceRef = dbRef.collection("sources").doc(sourceId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Source not found");
    }
    const sourceData = sourceSnap.data();
    if (sourceData.userId !== userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    const now = firestore_1.Timestamp.now();
    let deletedImports = 0;
    let deletedTransactions = 0;
    let deletedTrades = 0;
    // 1. Clear linkedSourceId on any credit cards that link to this bank account
    const linkedCardsQuery = await dbRef
        .collection("sources")
        .where("userId", "==", userId)
        .where("linkedSourceId", "==", sourceId)
        .get();
    if (!linkedCardsQuery.empty) {
        const batch = dbRef.batch();
        for (const cardDoc of linkedCardsQuery.docs) {
            batch.update(cardDoc.ref, {
                linkedSourceId: null,
                updatedAt: now,
            });
        }
        await batch.commit();
    }
    // 2. Delete all imports for this source
    const importsQuery = await dbRef
        .collection("imports")
        .where("userId", "==", userId)
        .where("sourceId", "==", sourceId)
        .get();
    if (!importsQuery.empty) {
        for (let i = 0; i < importsQuery.docs.length; i += BATCH_SIZE) {
            const batch = dbRef.batch();
            const chunk = importsQuery.docs.slice(i, i + BATCH_SIZE);
            for (const importDoc of chunk) {
                batch.delete(importDoc.ref);
                deletedImports++;
            }
            await batch.commit();
        }
    }
    // 3. Delete all transactions for this source
    const transactionsQuery = await dbRef
        .collection("transactions")
        .where("userId", "==", userId)
        .where("sourceId", "==", sourceId)
        .get();
    if (!transactionsQuery.empty) {
        for (let i = 0; i < transactionsQuery.docs.length; i += BATCH_SIZE) {
            const chunk = transactionsQuery.docs.slice(i, i + BATCH_SIZE);
            // First, delete file connections for each transaction
            for (const txDoc of chunk) {
                const connectionsQuery = await dbRef
                    .collection("fileConnections")
                    .where("transactionId", "==", txDoc.id)
                    .get();
                if (!connectionsQuery.empty) {
                    const connBatch = dbRef.batch();
                    for (const connDoc of connectionsQuery.docs) {
                        connBatch.delete(connDoc.ref);
                        // Update file to remove transaction from transactionIds
                        const fileRef = dbRef.collection("files").doc(connDoc.data().fileId);
                        connBatch.update(fileRef, {
                            transactionIds: firestore_1.FieldValue.arrayRemove(txDoc.id),
                            updatedAt: now,
                        });
                    }
                    await connBatch.commit();
                }
            }
            // Then delete the transactions
            const txBatch = dbRef.batch();
            for (const txDoc of chunk) {
                txBatch.delete(txDoc.ref);
                deletedTransactions++;
            }
            await txBatch.commit();
        }
    }
    // 4. Clean up API provider connections if this was an API source
    if (sourceData.type === "api" && sourceData.apiConfig) {
        const apiConfig = sourceData.apiConfig;
        if (apiConfig.provider === "truelayer" && apiConfig.connectionId) {
            try {
                const connectionRef = dbRef.collection("truelayerConnections").doc(apiConfig.connectionId);
                await connectionRef.delete();
            }
            catch (err) {
                console.warn(`[deleteSource] Failed to delete TrueLayer connection:`, err);
            }
        }
        // Delete finAPI bank connection
        if (apiConfig.provider === "finapi" && apiConfig.bankConnectionId) {
            try {
                const clientId = process.env.FINAPI_CLIENT_ID;
                const clientSecret = process.env.FINAPI_CLIENT_SECRET;
                const environment = process.env.FINAPI_ENVIRONMENT || "sandbox";
                const baseUrl = environment === "production"
                    ? "https://live.finapi.io"
                    : "https://sandbox.finapi.io";
                if (clientId && clientSecret) {
                    let accessToken = apiConfig.userAccessToken;
                    const refreshToken = sourceData.apiConfig.userRefreshToken;
                    // Try to refresh the token first if we have a refresh token
                    if (refreshToken) {
                        try {
                            const tokenResponse = await fetch(`${baseUrl}/api/v2/oauth/token`, {
                                method: "POST",
                                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                body: new URLSearchParams({
                                    grant_type: "refresh_token",
                                    client_id: clientId,
                                    client_secret: clientSecret,
                                    refresh_token: refreshToken,
                                }).toString(),
                            });
                            if (tokenResponse.ok) {
                                const tokenData = await tokenResponse.json();
                                accessToken = tokenData.access_token;
                                console.log(`[deleteSource] Refreshed finAPI token for bank connection delete`);
                            }
                        }
                        catch (refreshErr) {
                            console.warn(`[deleteSource] Failed to refresh finAPI token:`, refreshErr);
                        }
                    }
                    if (accessToken) {
                        const response = await fetch(`${baseUrl}/api/v2/bankConnections/${apiConfig.bankConnectionId}`, {
                            method: "DELETE",
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                            },
                        });
                        if (response.ok) {
                            console.log(`[deleteSource] Deleted finAPI bank connection: ${apiConfig.bankConnectionId}`);
                        }
                        else {
                            const errorText = await response.text();
                            console.warn(`[deleteSource] finAPI delete returned ${response.status}: ${errorText}`);
                        }
                    }
                    else {
                        console.warn(`[deleteSource] No access token available to delete finAPI connection`);
                    }
                }
            }
            catch (err) {
                console.warn(`[deleteSource] Failed to delete finAPI connection:`, err);
            }
        }
    }
    // 5. Delete investment trades for depot sources
    if (sourceData.accountKind === "depot") {
        const tradesQuery = await dbRef
            .collection("investmentTrades")
            .where("userId", "==", userId)
            .where("sourceId", "==", sourceId)
            .get();
        if (!tradesQuery.empty) {
            for (let i = 0; i < tradesQuery.docs.length; i += BATCH_SIZE) {
                const tradeBatch = dbRef.batch();
                const chunk = tradesQuery.docs.slice(i, i + BATCH_SIZE);
                for (const tradeDoc of chunk) {
                    tradeBatch.delete(tradeDoc.ref);
                    deletedTrades++;
                }
                await tradeBatch.commit();
            }
        }
        if (deletedTrades > 0) {
            console.log(`[deleteSource] Deleted ${deletedTrades} investment trades for depot ${sourceId}`);
        }
    }
    // 6. Delete source partner if exists
    if (sourceData.sourcePartnerId) {
        try {
            const partnerRef = dbRef.collection("partners").doc(sourceData.sourcePartnerId);
            const partnerSnap = await partnerRef.get();
            if (partnerSnap.exists && partnerSnap.data()?.userId === userId) {
                await partnerRef.delete();
                console.log(`[deleteSource] Deleted source partner ${sourceData.sourcePartnerId}`);
            }
        }
        catch (err) {
            console.warn(`[deleteSource] Failed to delete source partner:`, err);
        }
    }
    // 7. Delete the source document itself
    await sourceRef.delete();
    console.log(`[deleteSource] Deleted source ${sourceId}`, {
        userId,
        deletedImports,
        deletedTransactions,
    });
    return {
        success: true,
        deletedImports,
        deletedTransactions,
        deletedTrades,
    };
}
exports.deleteSourceCallable = (0, createCallable_1.createCallable)({
    name: "deleteSource",
    timeoutSeconds: 300,
    memory: "1GiB",
}, async (ctx, request) => {
    return deleteSourceInternal(ctx.db, ctx.userId, request.sourceId);
});
//# sourceMappingURL=deleteSource.js.map