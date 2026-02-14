"use strict";
/**
 * Calculate FIFO cost basis for all trades in a depot source.
 * Groups trades by ticker, calculates cost basis for sells,
 * and writes results back to trade documents.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFifoCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const fifoUtils_1 = require("./fifoUtils");
const BATCH_SIZE = 500;
exports.calculateFifoCallable = (0, createCallable_1.createCallable)({
    name: "calculateFifo",
    timeoutSeconds: 300,
    memory: "1GiB",
}, async (ctx, request) => {
    const { sourceId } = request;
    if (!sourceId) {
        throw new createCallable_1.HttpsError("invalid-argument", "sourceId is required");
    }
    // Verify source ownership
    const sourceSnap = await ctx.db.collection("sources").doc(sourceId).get();
    if (!sourceSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Source not found");
    }
    if (sourceSnap.data().userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    if (sourceSnap.data().accountKind !== "depot") {
        throw new createCallable_1.HttpsError("invalid-argument", "Source is not a depot");
    }
    // Fetch all trades for this source, ordered by date
    const tradesSnap = await ctx.db
        .collection("investmentTrades")
        .where("userId", "==", ctx.userId)
        .where("sourceId", "==", sourceId)
        .orderBy("date", "asc")
        .get();
    if (tradesSnap.empty) {
        return { success: true, tradesProcessed: 0, sellsCalculated: 0 };
    }
    // Convert to typed trades
    const trades = tradesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
    }));
    // Group by ticker
    const byTicker = new Map();
    for (const trade of trades) {
        const key = trade.ticker.toUpperCase();
        if (!byTicker.has(key)) {
            byTicker.set(key, []);
        }
        byTicker.get(key).push(trade);
    }
    // Calculate FIFO per ticker
    let sellsCalculated = 0;
    const updates = [];
    for (const [, tickerTrades] of byTicker) {
        const results = (0, fifoUtils_1.calculateFifoForTicker)(tickerTrades);
        for (const result of results) {
            sellsCalculated++;
            updates.push({
                tradeId: result.tradeId,
                data: {
                    realizedGainEur: result.realizedGainEur,
                    costBasisEur: result.costBasisEur,
                    fifoLotAssignments: result.lotAssignments.map((a) => ({
                        buyTradeId: a.buyTradeId,
                        quantity: a.quantity,
                        costPerUnitEur: a.costPerUnitEur,
                        buyDate: a.buyDate,
                    })),
                    isAltbestand: result.isAltbestand,
                    isHoldingPeriodExempt: result.isHoldingPeriodExempt,
                    fifoCalculated: true,
                    updatedAt: firestore_1.Timestamp.now(),
                },
            });
        }
        // Also mark buys as fifoCalculated
        for (const trade of tickerTrades) {
            if (trade.tradeType === "buy" || trade.tradeType === "transfer_in") {
                updates.push({
                    tradeId: trade.id,
                    data: {
                        fifoCalculated: true,
                        updatedAt: firestore_1.Timestamp.now(),
                    },
                });
            }
        }
    }
    // Write updates in batches
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = ctx.db.batch();
        const chunk = updates.slice(i, i + BATCH_SIZE);
        for (const update of chunk) {
            const ref = ctx.db.collection("investmentTrades").doc(update.tradeId);
            batch.update(ref, update.data);
        }
        await batch.commit();
    }
    console.log(`[calculateFifo] Processed ${trades.length} trades, calculated ${sellsCalculated} sells`, {
        userId: ctx.userId,
        sourceId,
    });
    return {
        success: true,
        tradesProcessed: trades.length,
        sellsCalculated,
    };
});
//# sourceMappingURL=calculateFifo.js.map