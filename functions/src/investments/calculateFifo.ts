/**
 * Calculate FIFO cost basis for all trades in a depot source.
 * Groups trades by ticker, calculates cost basis for sells,
 * and writes results back to trade documents.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import { InvestmentTrade } from "../types/investment-trade";
import { calculateFifoForTicker } from "./fifoUtils";

interface CalculateFifoRequest {
  sourceId: string;
}

interface CalculateFifoResponse {
  success: boolean;
  tradesProcessed: number;
  sellsCalculated: number;
}

const BATCH_SIZE = 500;

export const calculateFifoCallable = createCallable<
  CalculateFifoRequest,
  CalculateFifoResponse
>(
  {
    name: "calculateFifo",
    timeoutSeconds: 300,
    memory: "1GiB",
  },
  async (ctx, request) => {
    const { sourceId } = request;

    if (!sourceId) {
      throw new HttpsError("invalid-argument", "sourceId is required");
    }

    // Verify source ownership
    const sourceSnap = await ctx.db.collection("sources").doc(sourceId).get();
    if (!sourceSnap.exists) {
      throw new HttpsError("not-found", "Source not found");
    }
    if (sourceSnap.data()!.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Access denied");
    }
    if (sourceSnap.data()!.accountKind !== "depot") {
      throw new HttpsError("invalid-argument", "Source is not a depot");
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
    const trades: InvestmentTrade[] = tradesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as InvestmentTrade[];

    // Group by ticker
    const byTicker = new Map<string, InvestmentTrade[]>();
    for (const trade of trades) {
      const key = trade.ticker.toUpperCase();
      if (!byTicker.has(key)) {
        byTicker.set(key, []);
      }
      byTicker.get(key)!.push(trade);
    }

    // Calculate FIFO per ticker
    let sellsCalculated = 0;
    const updates: { tradeId: string; data: Record<string, unknown> }[] = [];

    for (const [, tickerTrades] of byTicker) {
      const results = calculateFifoForTicker(tickerTrades);

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
            updatedAt: Timestamp.now(),
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
              updatedAt: Timestamp.now(),
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
  }
);
