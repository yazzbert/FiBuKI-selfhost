"use strict";
/**
 * finAPI Sync Callable
 *
 * Cloud Function for syncing transactions from finAPI.
 * Uses Firebase secrets for credentials.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncFinapiTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
// Define secrets
const finapiClientId = (0, params_1.defineSecret)("FINAPI_CLIENT_ID");
const finapiClientSecret = (0, params_1.defineSecret)("FINAPI_CLIENT_SECRET");
const db = (0, firestore_1.getFirestore)();
// finAPI base URLs
const FINAPI_SANDBOX_URL = "https://sandbox.finapi.io";
const FINAPI_LIVE_URL = "https://live.finapi.io";
// Use sandbox by default, can be configured via env
const BASE_URL = process.env.FINAPI_ENVIRONMENT === "live"
    ? FINAPI_LIVE_URL
    : FINAPI_SANDBOX_URL;
// ============================================================================
// Helper Functions
// ============================================================================
async function refreshUserToken(refreshToken, clientId, clientSecret) {
    const formData = new URLSearchParams();
    formData.append("grant_type", "refresh_token");
    formData.append("client_id", clientId);
    formData.append("client_secret", clientSecret);
    formData.append("refresh_token", refreshToken);
    const response = await fetch(`${BASE_URL}/api/v2/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.errors?.[0]?.message || `Token refresh failed: ${response.status}`);
    }
    return response.json();
}
async function fetchTransactions(userToken, accountIds, minDate, maxDate) {
    const allTransactions = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
        const params = new URLSearchParams({
            accountIds: accountIds.join(","),
            page: String(page),
            perPage: "500",
            view: "bankView",
            direction: "all",
        });
        if (minDate)
            params.append("minBankBookingDate", minDate);
        if (maxDate)
            params.append("maxBankBookingDate", maxDate);
        const response = await fetch(`${BASE_URL}/api/v2/transactions?${params}`, {
            headers: { Authorization: `Bearer ${userToken}` },
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.errors?.[0]?.message || `Fetch failed: ${response.status}`);
        }
        const data = await response.json();
        allTransactions.push(...data.transactions);
        hasMore = page < data.paging.totalPages;
        page++;
    }
    return allTransactions;
}
function generateDedupeHash(tx, sourceId) {
    const data = `${sourceId}|${tx.bankBookingDate}|${tx.amount}|${tx.id}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return `finapi_${Math.abs(hash).toString(36)}`;
}
// ============================================================================
// Callable Function
// ============================================================================
exports.syncFinapiTransactions = (0, https_1.onCall)({
    region: "europe-west1",
    secrets: [finapiClientId, finapiClientSecret],
    timeoutSeconds: 300,
    memory: "512MiB",
}, async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
        throw new https_1.HttpsError("unauthenticated", "Must be authenticated");
    }
    const { sourceId } = request.data;
    if (!sourceId) {
        throw new https_1.HttpsError("invalid-argument", "sourceId is required");
    }
    // Get source
    const sourceRef = db.collection("sources").doc(sourceId);
    const sourceDoc = await sourceRef.get();
    if (!sourceDoc.exists) {
        throw new https_1.HttpsError("not-found", "Source not found");
    }
    const source = sourceDoc.data();
    if (source?.userId !== userId) {
        throw new https_1.HttpsError("permission-denied", "Not your source");
    }
    if (source?.type !== "api" || source?.apiConfig?.provider !== "finapi") {
        throw new https_1.HttpsError("invalid-argument", "Source is not a finAPI connection");
    }
    const config = source.apiConfig;
    const clientId = finapiClientId.value();
    const clientSecret = finapiClientSecret.value();
    // Check if token needs refresh
    let userToken = config.userAccessToken;
    const tokenExpiry = config.tokenExpiresAt?.toDate() || new Date(0);
    if (Date.now() > tokenExpiry.getTime() - 5 * 60 * 1000) {
        // Refresh token
        const tokenResponse = await refreshUserToken(config.userRefreshToken, clientId, clientSecret);
        userToken = tokenResponse.access_token;
        // Update stored tokens
        await sourceRef.update({
            "apiConfig.userAccessToken": tokenResponse.access_token,
            "apiConfig.userRefreshToken": tokenResponse.refresh_token || config.userRefreshToken,
            "apiConfig.tokenExpiresAt": firestore_1.Timestamp.fromDate(new Date(Date.now() + tokenResponse.expires_in * 1000)),
        });
    }
    // Calculate date range
    const lastSyncAt = config.lastSyncAt?.toDate();
    const minDate = lastSyncAt
        ? new Date(lastSyncAt.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const maxDate = new Date().toISOString().split("T")[0];
    // Fetch transactions
    const accountId = parseInt(config.accountId, 10);
    const transactions = await fetchTransactions(userToken, [accountId], minDate, maxDate);
    if (transactions.length === 0) {
        await sourceRef.update({
            "apiConfig.lastSyncAt": firestore_1.Timestamp.now(),
            "apiConfig.lastSyncError": firestore_1.FieldValue.delete(),
        });
        return { imported: 0, skipped: 0, total: 0 };
    }
    // Check for existing transactions (deduplication)
    const hashes = transactions.map((tx) => generateDedupeHash(tx, sourceId));
    const existingQuery = await db
        .collection("transactions")
        .where("sourceId", "==", sourceId)
        .where("dedupeHash", "in", hashes.slice(0, 30)) // Firestore limit
        .get();
    const existingHashes = new Set(existingQuery.docs.map((d) => d.data().dedupeHash));
    // Create new transactions
    const batch = db.batch();
    let imported = 0;
    const syncJobId = `finapi_sync_${sourceId}_${Date.now()}`;
    for (const tx of transactions) {
        const dedupeHash = generateDedupeHash(tx, sourceId);
        if (existingHashes.has(dedupeHash))
            continue;
        const txRef = db.collection("transactions").doc();
        batch.set(txRef, {
            userId,
            sourceId,
            date: firestore_1.Timestamp.fromDate(new Date(tx.bankBookingDate)),
            amount: Math.round(tx.amount * 100), // Convert to cents
            currency: tx.currency || "EUR",
            name: tx.counterpartName || tx.purpose || "Unknown",
            partner: tx.counterpartName || null,
            partnerIban: tx.counterpartIban || null,
            reference: tx.endToEndReference || tx.mandateReference || null,
            description: tx.purpose || null,
            dedupeHash,
            importJobId: syncJobId,
            fileIds: [],
            isComplete: false,
            partnerId: null,
            partnerType: null,
            partnerMatchConfidence: null,
            partnerMatchedBy: null,
            noReceiptCategoryId: null,
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
        imported++;
        if (imported >= 500)
            break; // Batch limit
    }
    if (imported > 0) {
        await batch.commit();
    }
    // Update source
    await sourceRef.update({
        "apiConfig.lastSyncAt": firestore_1.Timestamp.now(),
        "apiConfig.lastSyncError": firestore_1.FieldValue.delete(),
    });
    return {
        imported,
        skipped: existingHashes.size,
        total: transactions.length,
    };
});
//# sourceMappingURL=syncCallable.js.map