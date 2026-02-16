"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPartnerMatchingContext = loadPartnerMatchingContext;
exports.processPartnerMatchesForTransactions = processPartnerMatchesForTransactions;
exports.applyPartnerMatchUpdates = applyPartnerMatchUpdates;
exports.queuePartnerMatchingWorker = queuePartnerMatchingWorker;
const firestore_1 = require("firebase-admin/firestore");
const partner_matcher_1 = require("../utils/partner-matcher");
const createLocalPartnerFromGlobal_1 = require("./createLocalPartnerFromGlobal");
const db = (0, firestore_1.getFirestore)();
const MAX_BATCH_SIZE = 500;
function normalizeSuggestions(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((item) => {
        if (!item || typeof item !== "object")
            return null;
        const candidate = item;
        if (typeof candidate.partnerId !== "string")
            return null;
        if (candidate.partnerType !== "global" && candidate.partnerType !== "user")
            return null;
        if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence))
            return null;
        if (typeof candidate.source !== "string")
            return null;
        return {
            partnerId: candidate.partnerId,
            partnerType: candidate.partnerType,
            confidence: candidate.confidence,
            source: candidate.source,
        };
    })
        .filter((item) => item !== null);
}
function suggestionsAreEqual(existing, next) {
    if (existing.length !== next.length)
        return false;
    for (let i = 0; i < existing.length; i++) {
        if (existing[i].partnerId !== next[i].partnerId)
            return false;
        if (existing[i].partnerType !== next[i].partnerType)
            return false;
        if (existing[i].confidence !== next[i].confidence)
            return false;
        if (existing[i].source !== next[i].source)
            return false;
    }
    return true;
}
async function loadPartnerMatchingContext(userId) {
    const [userPartnersSnapshot, globalPartnersSnapshot] = await Promise.all([
        db
            .collection("partners")
            .where("userId", "==", userId)
            .where("isActive", "==", true)
            .get(),
        db.collection("globalPartners").where("isActive", "==", true).get(),
    ]);
    const partnerManualRemovals = new Map();
    const userPartners = userPartnersSnapshot.docs.map((doc) => {
        const data = doc.data();
        const removals = data.manualRemovals || [];
        if (removals.length > 0) {
            partnerManualRemovals.set(doc.id, new Set(removals.map((r) => r.transactionId)));
        }
        return {
            id: doc.id,
            name: data.name,
            aliases: data.aliases || [],
            ibans: data.ibans || [],
            website: data.website,
            vatId: data.vatId,
            learnedPatterns: data.learnedPatterns || [],
            globalPartnerId: data.globalPartnerId || null,
        };
    });
    const globalPartners = globalPartnersSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            name: data.name,
            aliases: data.aliases || [],
            ibans: data.ibans || [],
            website: data.website,
            vatId: data.vatId,
            patterns: data.patterns || [],
        };
    });
    const localizedGlobalIds = new Set(userPartners
        .map((partner) => partner.globalPartnerId)
        .filter(Boolean));
    const filteredGlobalPartners = globalPartners.filter((partner) => !localizedGlobalIds.has(partner.id));
    const partnerNameMap = new Map();
    for (const p of userPartners) {
        partnerNameMap.set(p.id, p.name);
    }
    for (const p of filteredGlobalPartners) {
        partnerNameMap.set(p.id, p.name);
    }
    return {
        userPartners,
        filteredGlobalPartners,
        partnerManualRemovals,
        partnerNameMap,
    };
}
async function processPartnerMatchesForTransactions(options) {
    const { userId, transactions, partnerContext, skipUnchangedSuggestions = false, collectAgenticFallback = false, } = options;
    let processed = 0;
    let autoMatched = 0;
    let withSuggestions = 0;
    const processedTransactionIds = [];
    const autoMatchedPartnerIds = new Set();
    const noAutoMatchTransactions = [];
    const writeOperations = [];
    for (const txDoc of transactions) {
        if (txDoc.exists === false)
            continue;
        const txData = txDoc.data();
        if (!txData)
            continue;
        if (txData.partnerId) {
            continue;
        }
        if (txData.noReceiptCategoryId) {
            continue;
        }
        if (txData.quotaExceeded) {
            continue;
        }
        const transaction = {
            id: txDoc.id,
            partner: txData.partner || null,
            partnerIban: txData.partnerIban || null,
            name: txData.name || "",
            reference: txData.reference || null,
        };
        const matches = (0, partner_matcher_1.matchTransaction)(transaction, partnerContext.userPartners, partnerContext.filteredGlobalPartners);
        processed++;
        if (matches.length === 0) {
            continue;
        }
        const filteredMatches = matches.filter((m) => {
            const removals = partnerContext.partnerManualRemovals.get(m.partnerId);
            if (removals && removals.has(txDoc.id)) {
                console.log(`  -> Skipping partner ${m.partnerId} - tx ${txDoc.id} was manually removed`);
                return false;
            }
            return true;
        });
        if (filteredMatches.length === 0) {
            continue;
        }
        const topMatch = filteredMatches[0];
        const nextSuggestions = filteredMatches.map((m) => ({
            partnerId: m.partnerId,
            partnerType: m.partnerType,
            confidence: m.confidence,
            source: m.source,
        }));
        const existingSuggestions = normalizeSuggestions(txData.partnerSuggestions);
        const suggestionsChanged = !suggestionsAreEqual(existingSuggestions, nextSuggestions);
        const updates = {
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if ((0, partner_matcher_1.shouldAutoApply)(topMatch.confidence)) {
            updates.partnerSuggestions = nextSuggestions;
            let assignedPartnerId = topMatch.partnerId;
            let assignedPartnerType = topMatch.partnerType;
            if (topMatch.partnerType === "global") {
                try {
                    assignedPartnerId = await (0, createLocalPartnerFromGlobal_1.createLocalPartnerFromGlobal)(userId, topMatch.partnerId);
                    assignedPartnerType = "user";
                }
                catch (error) {
                    console.error(`[PartnerMatch] Failed to create local partner from global:`, error);
                }
            }
            updates.partnerId = assignedPartnerId;
            updates.partnerType = assignedPartnerType;
            updates.partnerMatchConfidence = topMatch.confidence;
            updates.partnerMatchedBy = "auto";
            autoMatched++;
            const partnerName = partnerContext.partnerNameMap.get(assignedPartnerId) ||
                partnerContext.partnerNameMap.get(topMatch.partnerId) ||
                null;
            updates.automationHistory = firestore_1.FieldValue.arrayUnion({
                type: "partner_assigned",
                ranAt: firestore_1.Timestamp.now(),
                status: "completed",
                actor: "auto",
                level: "outcome",
                forPartnerId: assignedPartnerId,
                partnerName,
                confidence: topMatch.confidence,
                summary: `Partner "${partnerName || assignedPartnerId}" auto-assigned`,
            });
            if (assignedPartnerType === "user") {
                autoMatchedPartnerIds.add(assignedPartnerId);
            }
        }
        else {
            if (skipUnchangedSuggestions && !suggestionsChanged) {
                continue;
            }
            updates.partnerSuggestions = nextSuggestions;
            withSuggestions++;
            if (collectAgenticFallback) {
                noAutoMatchTransactions.push({
                    id: txDoc.id,
                    data: transaction,
                    topConfidence: topMatch.confidence,
                });
            }
        }
        writeOperations.push({
            ref: txDoc.ref,
            updates,
        });
        processedTransactionIds.push(txDoc.id);
    }
    return {
        processed,
        autoMatched,
        withSuggestions,
        processedTransactionIds,
        autoMatchedPartnerIds,
        noAutoMatchTransactions,
        writeOperations,
    };
}
async function applyPartnerMatchUpdates(writeOperations) {
    if (writeOperations.length === 0) {
        return;
    }
    let batch = db.batch();
    let batchCount = 0;
    for (const operation of writeOperations) {
        batch.update(operation.ref, operation.updates);
        batchCount++;
        if (batchCount >= MAX_BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (batchCount > 0) {
        await batch.commit();
    }
}
async function queuePartnerMatchingWorker(userId, initialPrompt, triggerContext) {
    const requestRef = db.collection(`users/${userId}/workerRequests`).doc();
    await requestRef.set({
        id: requestRef.id,
        workerType: "partner_matching",
        initialPrompt,
        triggerContext,
        triggeredBy: "auto",
        status: "pending",
        createdAt: firestore_1.Timestamp.now(),
    });
    return requestRef.id;
}
//# sourceMappingURL=partnerMatchingShared.js.map