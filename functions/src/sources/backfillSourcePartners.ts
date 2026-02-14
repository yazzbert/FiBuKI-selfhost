/**
 * Backfill Source Partners
 *
 * One-time callable to create partners for existing sources that don't have one.
 * Idempotent — skips sources that already have a sourcePartnerId.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createCallable } from "../utils/createCallable";
import { buildSourcePartnerData } from "./sourcePartnerUtils";

interface BackfillRequest {
  // empty — operates on all sources for the calling user
}

interface BackfillResponse {
  success: boolean;
  created: number;
  skipped: number;
}

export const backfillSourcePartnersCallable = createCallable<
  BackfillRequest,
  BackfillResponse
>(
  { name: "backfillSourcePartners" },
  async (ctx) => {
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

      const now = Timestamp.now();

      const partnerData = buildSourcePartnerData({
        name: sourceData.name || sourceDoc.id,
        accountKind: sourceData.accountKind || "bank_account",
        iban: sourceData.iban,
        cardLast4: sourceData.cardLast4,
        cardBrand: sourceData.cardBrand,
      });

      const newPartner: Record<string, unknown> = {
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
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[backfill] Created source partner ${partnerRef.id} for source ${sourceDoc.id} ("${sourceData.name}")`);
      created++;
    }

    console.log(`[backfillSourcePartners] Done: created=${created}, skipped=${skipped}`);

    return { success: true, created, skipped };
  }
);
