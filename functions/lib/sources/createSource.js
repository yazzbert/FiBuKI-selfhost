"use strict";
/**
 * Create a new source (bank account)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSourceCallable = void 0;
exports.createSourceInternal = createSourceInternal;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const sourcePartnerUtils_1 = require("./sourcePartnerUtils");
/**
 * Normalize IBAN by removing spaces and converting to uppercase
 */
function normalizeIban(iban) {
    return iban.replace(/\s/g, "").toUpperCase();
}
/**
 * Internal implementation for creating a source.
 * Can be called directly from MCP handlers.
 */
async function createSourceInternal(dbRef, userId, data, options) {
    if (!data?.name?.trim()) {
        throw new createCallable_1.HttpsError("invalid-argument", "Source name is required");
    }
    if (!data.currency) {
        throw new createCallable_1.HttpsError("invalid-argument", "Currency is required");
    }
    // Check investments addon for depot sources
    if (data.accountKind === "depot") {
        if (!options?.isAdmin) {
            const subSnap = await dbRef.collection("subscriptions").doc(userId).get();
            if (!subSnap.exists || !subSnap.data()?.addons?.investments?.active) {
                throw new createCallable_1.HttpsError("permission-denied", "Investments addon required for depot accounts. Activate it in Settings > Billing.");
            }
        }
    }
    const now = firestore_1.Timestamp.now();
    const newSource = {
        name: data.name.trim(),
        accountKind: data.accountKind || "bank_account",
        iban: data.iban ? normalizeIban(data.iban) : null,
        linkedSourceId: data.linkedSourceId || null,
        cardLast4: data.cardLast4 || null,
        cardBrand: data.cardBrand || null,
        currency: data.currency,
        type: data.type || "manual",
        isActive: true,
        userId,
        createdAt: now,
        updatedAt: now,
    };
    // Add broker name for depot sources
    if (data.accountKind === "depot" && data.brokerName) {
        newSource.brokerName = data.brokerName;
    }
    const docRef = await dbRef.collection("sources").add(newSource);
    const sourceId = docRef.id;
    // Auto-create source partner for pattern learning + reconciliation
    // Skip for depot sources — they don't participate in transaction matching
    if (data.accountKind === "depot") {
        console.log(`[createSource] Created depot source ${sourceId} (broker: ${data.brokerName || "unknown"})`, {
            userId,
            name: data.name,
        });
        return { success: true, sourceId };
    }
    try {
        const partnerData = (0, sourcePartnerUtils_1.buildSourcePartnerData)({
            name: newSource.name,
            accountKind: newSource.accountKind,
            iban: newSource.iban,
            cardLast4: newSource.cardLast4,
            cardBrand: newSource.cardBrand,
        });
        const newPartner = {
            userId,
            name: partnerData.name,
            aliases: partnerData.aliases,
            address: null,
            country: null,
            vatId: null,
            ibans: partnerData.ibans,
            website: null,
            notes: null,
            defaultCategoryId: null,
            identitySourceField: `source:${sourceId}`,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            createdBy: "source_sync",
        };
        // If credit card with a linked bank, add categoryMatchRule for internal-transfers
        if (newSource.accountKind === "credit_card" && newSource.linkedSourceId) {
            const categoriesSnap = await dbRef
                .collection("noReceiptCategories")
                .where("userId", "==", userId)
                .where("templateId", "==", "internal-transfers")
                .where("isActive", "==", true)
                .limit(1)
                .get();
            if (!categoriesSnap.empty) {
                const categoryDoc = categoriesSnap.docs[0];
                newPartner.categoryMatchRules = [{
                        categoryId: categoryDoc.id,
                        templateId: "internal-transfers",
                        confidence: 95,
                        source: "source_sync",
                    }];
            }
        }
        const partnerRef = await dbRef.collection("partners").add(newPartner);
        // Write sourcePartnerId back to the source
        await docRef.update({
            sourcePartnerId: partnerRef.id,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        console.log(`[createSource] Created source partner ${partnerRef.id} for source ${sourceId}`, {
            aliases: partnerData.aliases.length,
        });
    }
    catch (err) {
        console.error(`[createSource] Failed to create source partner:`, err);
        // Non-fatal — source was still created successfully
    }
    console.log(`[createSource] Created source ${sourceId}`, {
        userId,
        name: data.name,
        type: data.type,
    });
    return {
        success: true,
        sourceId,
    };
}
exports.createSourceCallable = (0, createCallable_1.createCallable)({ name: "createSource" }, async (ctx, request) => {
    const isAdmin = ctx.request.auth?.token?.admin === true;
    return createSourceInternal(ctx.db, ctx.userId, request.data, { isAdmin });
});
//# sourceMappingURL=createSource.js.map