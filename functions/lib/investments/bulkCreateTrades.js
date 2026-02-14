"use strict";
/**
 * Bulk create investment trades from a broker CSV import
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bulkCreateTradesCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const BATCH_SIZE = 500;
exports.bulkCreateTradesCallable = (0, createCallable_1.createCallable)({
    name: "bulkCreateTrades",
    timeoutSeconds: 300,
    memory: "1GiB",
}, async (ctx, request) => {
    const { trades, sourceId } = request;
    if (!trades || !Array.isArray(trades)) {
        throw new createCallable_1.HttpsError("invalid-argument", "trades array is required");
    }
    if (!sourceId) {
        throw new createCallable_1.HttpsError("invalid-argument", "sourceId is required");
    }
    if (trades.length === 0) {
        return { success: true, tradeIds: [], count: 0 };
    }
    if (trades.length > 5000) {
        throw new createCallable_1.HttpsError("invalid-argument", "Cannot import more than 5000 trades at once");
    }
    // Verify source ownership and type
    const sourceRef = ctx.db.collection("sources").doc(sourceId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Source not found");
    }
    const sourceData = sourceSnap.data();
    if (sourceData.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Source access denied");
    }
    if (sourceData.accountKind !== "depot") {
        throw new createCallable_1.HttpsError("invalid-argument", "Source is not a depot account");
    }
    // Check investments addon access
    const subSnap = await ctx.db.collection("subscriptions").doc(ctx.userId).get();
    if (subSnap.exists) {
        const sub = subSnap.data();
        const isAdmin = ctx.request.auth?.token?.admin === true;
        if (!isAdmin && !sub.addons?.investments?.active) {
            throw new createCallable_1.HttpsError("permission-denied", "Investments addon required. Activate it in Settings > Billing.");
        }
    }
    const now = firestore_1.Timestamp.now();
    const tradeIds = [];
    // Process in batches
    for (let i = 0; i < trades.length; i += BATCH_SIZE) {
        const batch = ctx.db.batch();
        const chunk = trades.slice(i, i + BATCH_SIZE);
        for (const tradeData of chunk) {
            const docRef = ctx.db.collection("investmentTrades").doc();
            tradeIds.push(docRef.id);
            const date = new Date(tradeData.date);
            if (isNaN(date.getTime())) {
                throw new createCallable_1.HttpsError("invalid-argument", `Invalid date for trade: ${tradeData.date}`);
            }
            const tradeDoc = {
                userId: ctx.userId,
                sourceId: tradeData.sourceId,
                date: firestore_1.Timestamp.fromDate(date),
                tradeType: tradeData.tradeType,
                assetType: tradeData.assetType,
                ticker: tradeData.ticker,
                isin: tradeData.isin ?? null,
                assetName: tradeData.assetName,
                quantity: tradeData.quantity,
                pricePerUnit: tradeData.pricePerUnit,
                grossAmount: tradeData.grossAmount,
                fees: tradeData.fees,
                netAmount: tradeData.netAmount,
                currency: tradeData.currency,
                exchangeRateToEur: tradeData.exchangeRateToEur ?? null,
                netAmountEur: tradeData.netAmountEur ?? null,
                dedupeHash: tradeData.dedupeHash,
                importJobId: tradeData.importJobId,
                csvRowIndex: tradeData.csvRowIndex,
                _original: tradeData._original,
                // FIFO fields — not yet calculated
                realizedGainEur: null,
                costBasisEur: null,
                fifoCalculated: false,
                createdAt: now,
                updatedAt: now,
            };
            batch.set(docRef, tradeDoc);
        }
        await batch.commit();
    }
    console.log(`[bulkCreateTrades] Created ${tradeIds.length} trades`, {
        userId: ctx.userId,
        sourceId,
    });
    return {
        success: true,
        tradeIds,
        count: tradeIds.length,
    };
});
//# sourceMappingURL=bulkCreateTrades.js.map