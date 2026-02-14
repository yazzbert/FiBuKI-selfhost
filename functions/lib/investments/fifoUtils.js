"use strict";
/**
 * FIFO (First In, First Out) cost basis calculation utilities.
 *
 * Groups trades by ticker, processes buys into a lot queue,
 * and assigns cost basis to sells in chronological order.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTradeType = normalizeTradeType;
exports.detectAssetType = detectAssetType;
exports.calculateFifoForTicker = calculateFifoForTicker;
/** Altbestand cutoff date for Austrian crypto tax */
const AT_ALTBESTAND_CUTOFF = new Date("2021-03-01");
/**
 * Normalize trade type strings from various broker formats.
 */
function normalizeTradeType(raw) {
    const lower = raw.toLowerCase().trim();
    // Buys
    if (lower === "buy" || lower === "kauf" || lower === "market buy" ||
        lower === "open position" || lower === "long" ||
        lower === "deposit" || lower === "transfer_in" || lower === "transfer in") {
        return "buy";
    }
    // Sells
    if (lower === "sell" || lower === "verkauf" || lower === "market sell" ||
        lower === "close position" || lower === "short" ||
        lower === "withdrawal" || lower === "transfer_out" || lower === "transfer out") {
        return "sell";
    }
    // Dividends
    if (lower === "dividend" || lower === "dividende" || lower === "distribution") {
        return "dividend";
    }
    // Interest
    if (lower === "interest" || lower === "zinsen" || lower === "staking reward") {
        return "interest";
    }
    // Fees
    if (lower === "fee" || lower === "gebühr" || lower === "rollover fee" ||
        lower === "overnight fee" || lower === "spread") {
        return "fee";
    }
    // Transfers
    if (lower.includes("transfer in") || lower.includes("einzahlung")) {
        return "transfer_in";
    }
    if (lower.includes("transfer out") || lower.includes("auszahlung")) {
        return "transfer_out";
    }
    // Default: try to infer from sign
    return "buy";
}
/**
 * Detect asset type from ticker/ISIN/name heuristics.
 */
function detectAssetType(ticker, isin, assetName) {
    const t = ticker.toUpperCase();
    const name = (assetName || "").toLowerCase();
    // Crypto detection
    const cryptoTickers = new Set([
        "BTC", "ETH", "XRP", "ADA", "SOL", "DOT", "DOGE", "MATIC",
        "AVAX", "LINK", "UNI", "SHIB", "LTC", "BCH", "XLM", "ALGO",
        "ATOM", "FIL", "NEAR", "ICP", "APT", "ARB", "OP", "SUI",
    ]);
    if (cryptoTickers.has(t) || name.includes("bitcoin") || name.includes("ethereum")) {
        return "crypto";
    }
    // ETF detection
    if (name.includes("etf") || name.includes("ucits") ||
        name.includes("index fund") || name.includes("vanguard") ||
        name.includes("ishares") || name.includes("spdr") ||
        name.includes("xtrackers") || name.includes("lyxor") ||
        t.endsWith(".DE") || t.endsWith(".AS") || t.endsWith(".L")) {
        return "etf";
    }
    // Bond detection
    if (name.includes("bond") || name.includes("anleihe") || name.includes("treasury")) {
        return "bond";
    }
    // If it has an ISIN, it's likely a stock or ETF — default to stock
    if (isin) {
        return "stock";
    }
    return "other";
}
/**
 * Calculate FIFO cost basis for a set of trades for a single ticker.
 * Trades MUST be sorted by date ascending.
 *
 * @param trades - All trades for a single ticker, sorted by date ascending
 * @returns FIFO results for each sell trade
 */
function calculateFifoForTicker(trades) {
    const lotQueue = [];
    const results = [];
    for (const trade of trades) {
        if (trade.tradeType === "buy" || trade.tradeType === "transfer_in") {
            // Add to FIFO queue
            const costPerUnitEur = trade.netAmountEur != null
                ? Math.abs(trade.netAmountEur) / trade.quantity
                : Math.abs(trade.netAmount) / trade.quantity;
            lotQueue.push({
                buyTradeId: trade.id,
                buyDate: trade.date,
                remainingQuantity: trade.quantity,
                costPerUnitEur,
            });
        }
        else if (trade.tradeType === "sell" || trade.tradeType === "transfer_out") {
            // Consume from FIFO queue
            let remainingToSell = trade.quantity;
            let totalCostBasis = 0;
            const lotAssignments = [];
            let allAltbestand = true;
            let allHeldOverYear = true;
            while (remainingToSell > 0 && lotQueue.length > 0) {
                const lot = lotQueue[0];
                const consumed = Math.min(remainingToSell, lot.remainingQuantity);
                lotAssignments.push({
                    buyTradeId: lot.buyTradeId,
                    quantity: consumed,
                    costPerUnitEur: lot.costPerUnitEur,
                    buyDate: lot.buyDate,
                });
                totalCostBasis += consumed * lot.costPerUnitEur;
                // Check Altbestand (AT: crypto bought before 2021-03-01)
                const buyDate = lot.buyDate.toDate();
                if (buyDate >= AT_ALTBESTAND_CUTOFF) {
                    allAltbestand = false;
                }
                // Check holding period (DE: crypto held > 1 year)
                const sellDate = trade.date.toDate();
                const holdingDays = (sellDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24);
                if (holdingDays < 365) {
                    allHeldOverYear = false;
                }
                lot.remainingQuantity -= consumed;
                remainingToSell -= consumed;
                if (lot.remainingQuantity <= 0) {
                    lotQueue.shift();
                }
            }
            // Calculate realized gain
            const sellProceedsEur = trade.netAmountEur != null
                ? Math.abs(trade.netAmountEur)
                : Math.abs(trade.netAmount);
            const realizedGainEur = Math.round(sellProceedsEur - totalCostBasis);
            results.push({
                tradeId: trade.id,
                realizedGainEur,
                costBasisEur: Math.round(totalCostBasis),
                lotAssignments,
                isAltbestand: allAltbestand && lotAssignments.length > 0,
                isHoldingPeriodExempt: allHeldOverYear && lotAssignments.length > 0,
            });
        }
        // Dividends, interest, fees don't affect FIFO queue
    }
    return results;
}
//# sourceMappingURL=fifoUtils.js.map