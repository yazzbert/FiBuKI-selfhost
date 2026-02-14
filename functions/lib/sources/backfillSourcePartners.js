"use strict";
/**
 * Backfill Source Partners
 *
 * One-time callable to create partners for existing sources that don't have one.
 * Idempotent — skips sources that already have a sourcePartnerId.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillSourcePartnersCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const sourcePartnerUtils_1 = require("./sourcePartnerUtils");
exports.backfillSourcePartnersCallable = (0, createCallable_1.createCallable)({ name: "backfillSourcePartners" }, async (ctx) => {
    const sourcesSnap = await ctx.db
        .collection("sources")
        .where("userId", "==", ctx.userId)
        .where("isActive", "==", true)
        .get();
    let created = 0;
    let skipped = 0;
    for (const sourceDoc of sourcesSnap.docs) {
        const sourceData = sourceDoc.data();
        // Skip if already has a partner
        if (sourceData.sourcePartnerId) {
            skipped++;
            continue;
        }
        const now = firestore_1.Timestamp.now();
        const partnerData = (0, sourcePartnerUtils_1.buildSourcePartnerData)({
            name: sourceData.name || sourceDoc.id,
            accountKind: sourceData.accountKind || "bank_account",
            iban: sourceData.iban,
            cardLast4: sourceData.cardLast4,
            cardBrand: sourceData.cardBrand,
        });
        const newPartner = {
            userId: ctx.userId,
            name: partnerData.name,
            aliases: partnerData.aliases,
            address: null,
            country: null,
            vatId: null,
            ibans: partnerData.ibans,
            website: null,
            notes: null,
            defaultCategoryId: null,
            identitySourceField: `source:${sourceDoc.id}`,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            createdBy: "source_sync",
        };
        // For credit cards with linked bank, add category match rule
        if (sourceData.accountKind === "credit_card" && sourceData.linkedSourceId) {
            const categoriesSnap = await ctx.db
                .collection("noReceiptCategories")
                .where("userId", "==", ctx.userId)
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
        const partnerRef = await ctx.db.collection("partners").add(newPartner);
        await sourceDoc.ref.update({
            sourcePartnerId: partnerRef.id,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        console.log(`[backfill] Created source partner ${partnerRef.id} for source ${sourceDoc.id} ("${sourceData.name}")`);
        created++;
    }
    console.log(`[backfillSourcePartners] Done: created=${created}, skipped=${skipped}`);
    return { success: true, created, skipped };
});
//# sourceMappingURL=backfillSourcePartners.js.map