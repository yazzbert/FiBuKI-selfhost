"use strict";
/**
 * Swiss capital gains tax rules.
 *
 * - No capital gains tax for private investors
 * - Wealth tax on year-end holdings (cantonal rates vary)
 * - Need to report year-end portfolio value
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateYearEndHoldings = calculateYearEndHoldings;
/**
 * Calculate year-end holdings from trades.
 * Sums up all buys minus sells per ticker to get remaining positions.
 */
function calculateYearEndHoldings(trades, year) {
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    // Only consider trades up to year end
    const relevantTrades = trades.filter((t) => t.date.toDate() <= yearEnd);
    // Aggregate holdings per ticker
    const holdings = new Map();
    for (const trade of relevantTrades) {
        const key = trade.ticker.toUpperCase();
        if (!holdings.has(key)) {
            holdings.set(key, {
                ticker: trade.ticker,
                assetName: trade.assetName,
                assetType: trade.assetType,
                quantity: 0,
                totalCostEur: 0,
            });
        }
        const h = holdings.get(key);
        const amountEur = trade.netAmountEur ?? trade.netAmount;
        if (trade.tradeType === "buy" || trade.tradeType === "transfer_in") {
            h.quantity += trade.quantity;
            h.totalCostEur += Math.abs(amountEur);
        }
        else if (trade.tradeType === "sell" || trade.tradeType === "transfer_out") {
            h.quantity -= trade.quantity;
        }
    }
    // Return only positions with remaining quantity
    return Array.from(holdings.values())
        .filter((h) => h.quantity > 0.0001)
        .map((h) => ({
        ticker: h.ticker,
        assetName: h.assetName,
        assetType: h.assetType,
        quantity: h.quantity,
        // Use cost basis as approximate market value (user can override)
        marketValueEur: Math.round(h.totalCostEur),
    }));
}
//# sourceMappingURL=switzerland.js.map