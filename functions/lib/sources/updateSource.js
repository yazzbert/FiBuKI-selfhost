"use strict";
/**
 * Update a source (bank account)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSourceCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const sourcePartnerUtils_1 = require("./sourcePartnerUtils");
function normalizeIban(iban) {
    return iban.replace(/\s/g, "").toUpperCase();
}
exports.updateSourceCallable = (0, createCallable_1.createCallable)({ name: "updateSource" }, async (ctx, request) => {
    const { sourceId, data } = request;
    if (!sourceId) {
        throw new createCallable_1.HttpsError("invalid-argument", "sourceId is required");
    }
    // Verify ownership
    const sourceRef = ctx.db.collection("sources").doc(sourceId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Source not found");
    }
    if (sourceSnap.data().userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Access denied");
    }
    // Build update object
    const updates = {
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    if (data.name !== undefined) {
        updates.name = data.name.trim();
    }
    if (data.accountKind !== undefined) {
        updates.accountKind = data.accountKind;
    }
    if (data.iban !== undefined) {
        updates.iban = data.iban ? normalizeIban(data.iban) : null;
    }
    if (data.linkedSourceId !== undefined) {
        updates.linkedSourceId = data.linkedSourceId;
    }
    if (data.cardLast4 !== undefined) {
        updates.cardLast4 = data.cardLast4;
    }
    if (data.cardBrand !== undefined) {
        updates.cardBrand = data.cardBrand;
    }
    if (data.currency !== undefined) {
        updates.currency = data.currency;
    }
    if (data.fieldMappings !== undefined) {
        updates.fieldMappings = data.fieldMappings;
    }
    if (data.openingBalance !== undefined) {
        updates.openingBalance = data.openingBalance;
    }
    if (data.openingBalanceDate !== undefined) {
        updates.openingBalanceDate = data.openingBalanceDate
            ? firestore_1.Timestamp.fromDate(new Date(data.openingBalanceDate))
            : null;
    }
    if (data.openingBalanceSource !== undefined) {
        updates.openingBalanceSource = data.openingBalanceSource;
    }
    if (data.latestBalance !== undefined) {
        updates.latestBalance = data.latestBalance;
    }
    if (data.latestBalanceDate !== undefined) {
        updates.latestBalanceDate = data.latestBalanceDate
            ? firestore_1.Timestamp.fromDate(new Date(data.latestBalanceDate))
            : null;
    }
    await sourceRef.update(updates);
    // Sync source partner if partner-relevant fields changed
    const partnerRelevantFields = ["name", "iban", "cardLast4", "cardBrand"];
    const changedPartnerFields = partnerRelevantFields.filter((f) => f in updates);
    if (changedPartnerFields.length > 0) {
        const sourceData = sourceSnap.data();
        const sourcePartnerId = sourceData.sourcePartnerId;
        if (sourcePartnerId) {
            try {
                // Merge current source data with updates
                const mergedSource = {
                    name: updates.name || sourceData.name || "",
                    accountKind: sourceData.accountKind || "bank_account",
                    iban: updates.iban !== undefined ? updates.iban : sourceData.iban,
                    cardLast4: updates.cardLast4 !== undefined ? updates.cardLast4 : sourceData.cardLast4,
                    cardBrand: updates.cardBrand !== undefined ? updates.cardBrand : sourceData.cardBrand,
                };
                const partnerData = (0, sourcePartnerUtils_1.buildSourcePartnerData)(mergedSource);
                const partnerRef = ctx.db.collection("partners").doc(sourcePartnerId);
                const partnerSnap = await partnerRef.get();
                if (partnerSnap.exists && partnerSnap.data()?.userId === ctx.userId) {
                    await partnerRef.update({
                        name: partnerData.name,
                        aliases: partnerData.aliases,
                        ibans: partnerData.ibans,
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                    console.log(`[updateSource] Synced source partner ${sourcePartnerId}`, {
                        changedFields: changedPartnerFields,
                    });
                }
            }
            catch (err) {
                console.error(`[updateSource] Failed to sync source partner:`, err);
            }
        }
    }
    console.log(`[updateSource] Updated source ${sourceId}`, {
        userId: ctx.userId,
        fields: Object.keys(updates),
    });
    return { success: true };
});
//# sourceMappingURL=updateSource.js.map