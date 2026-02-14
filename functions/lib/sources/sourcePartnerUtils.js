"use strict";
/**
 * Source Partner Utilities
 *
 * Builds partner name and aliases from source data (bank accounts and credit cards).
 * Used when auto-creating source partners for pattern learning + reconciliation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSourcePartnerData = buildSourcePartnerData;
/**
 * Card brand display names and common variations used in bank transaction text.
 */
const CARD_BRAND_ALIASES = {
    visa: ["VISA", "Visa"],
    mastercard: ["Mastercard", "MC", "MasterCard"],
    amex: ["AMEX", "American Express", "AmEx"],
    discover: ["Discover"],
};
/**
 * Common German/English payment text patterns that appear alongside card brands.
 * These are combined with the card brand to create aliases.
 */
const PAYMENT_PREFIXES = [
    "Kartenzahlung",
    "Karte",
];
const PAYMENT_SUFFIXES = [
    "Abrechnung",
];
/**
 * Build partner name and aliases from source data.
 *
 * For credit cards: generates brand + last4 combinations and payment text patterns.
 * For bank accounts: uses source name and IBAN.
 */
function buildSourcePartnerData(source) {
    const name = source.name.trim();
    if (source.accountKind === "credit_card") {
        return buildCreditCardPartnerData(name, source.cardBrand, source.cardLast4);
    }
    return buildBankAccountPartnerData(name, source.iban);
}
function buildCreditCardPartnerData(sourceName, cardBrand, cardLast4) {
    const aliases = [];
    const brandNames = cardBrand ? CARD_BRAND_ALIASES[cardBrand] || [cardBrand.toUpperCase()] : [];
    // Brand name variations
    for (const brand of brandNames) {
        aliases.push(brand);
        if (cardLast4) {
            // "VISA 4242", "VISA*4242", "VISA/4242"
            aliases.push(`${brand} ${cardLast4}`);
            aliases.push(`${brand}*${cardLast4}`);
        }
        // Payment text patterns: "Kartenzahlung VISA", "VISA Abrechnung"
        for (const prefix of PAYMENT_PREFIXES) {
            aliases.push(`${prefix} ${brand}`);
        }
        for (const suffix of PAYMENT_SUFFIXES) {
            aliases.push(`${brand} ${suffix}`);
        }
    }
    // Last4-only patterns (brand-independent)
    if (cardLast4) {
        aliases.push(`Karte ${cardLast4}`);
    }
    return {
        name: sourceName,
        aliases,
        ibans: [],
    };
}
function buildBankAccountPartnerData(sourceName, iban) {
    return {
        name: sourceName,
        aliases: [],
        ibans: iban ? [iban] : [],
    };
}
//# sourceMappingURL=sourcePartnerUtils.js.map