"use strict";
/**
 * German capital gains tax rules.
 *
 * - Stocks/ETFs: 26.375% Abgeltungssteuer (25% + 5.5% Soli)
 * - Crypto: personal income tax rate (14-45%), but TAX-FREE after 1yr holding
 * - Stock losses can ONLY offset stock gains (separate pool)
 * - Crypto losses offset crypto gains
 * - EUR 1,000 exemption (Sparerpauschbetrag) for stocks/ETFs
 * - Method: FIFO
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPARERPAUSCHBETRAG = exports.ABGELTUNGSSTEUER_RATE = void 0;
exports.calculateGermanyTax = calculateGermanyTax;
/** Abgeltungssteuer rate (25% + 5.5% Soli) */
exports.ABGELTUNGSSTEUER_RATE = 0.26375;
/** Annual exemption (Sparerpauschbetrag) in cents */
exports.SPARERPAUSCHBETRAG = 100000; // EUR 1,000
function calculateGermanyTax(summaries, cryptoExemptGainsEur) {
    let stockGains = 0;
    let stockLosses = 0;
    let cryptoGains = 0;
    let cryptoLosses = 0;
    for (const summary of summaries) {
        if (summary.assetType === "stock" || summary.assetType === "etf" || summary.assetType === "bond") {
            stockGains += summary.realizedGainEur + summary.dividendsEur;
            stockLosses += summary.realizedLossEur;
        }
        else if (summary.assetType === "crypto") {
            cryptoGains += summary.realizedGainEur + summary.dividendsEur;
            cryptoLosses += summary.realizedLossEur;
        }
    }
    return {
        deStockGainsEur: stockGains,
        deStockLossesEur: stockLosses,
        deCryptoGainsEur: cryptoGains,
        deCryptoLossesEur: cryptoLosses,
        deCryptoExemptGainsEur: cryptoExemptGainsEur,
    };
}
//# sourceMappingURL=germany.js.map