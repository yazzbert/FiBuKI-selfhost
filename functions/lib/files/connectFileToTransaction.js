"use strict";
/**
 * Connect a file to a transaction (many-to-many relationship)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectFileToTransactionCallable = void 0;
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const cancelWorkers_1 = require("../utils/cancelWorkers");
const activityLevel_1 = require("../utils/activityLevel");
exports.connectFileToTransactionCallable = (0, createCallable_1.createCallable)({ name: "connectFileToTransaction" }, async (ctx, request) => {
    const { fileId, transactionId, connectionType = "manual", matchConfidence, sourceInfo, allowAutoReassign = false, } = request;
    if (!fileId || !transactionId) {
        throw new createCallable_1.HttpsError("invalid-argument", "fileId and transactionId are required");
    }
    // Verify file ownership
    const fileRef = ctx.db.collection("files").doc(fileId);
    const fileSnap = await fileRef.get();
    if (!fileSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "File not found");
    }
    const fileData = fileSnap.data();
    if (fileData.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "File access denied");
    }
    // Verify transaction ownership
    const transactionRef = ctx.db.collection("transactions").doc(transactionId);
    const transactionSnap = await transactionRef.get();
    if (!transactionSnap.exists) {
        throw new createCallable_1.HttpsError("not-found", "Transaction not found");
    }
    const transactionData = transactionSnap.data();
    if (transactionData.userId !== ctx.userId) {
        throw new createCallable_1.HttpsError("permission-denied", "Transaction access denied");
    }
    // Block automated connections to over-quota transactions (manual still allowed)
    if (transactionData.quotaExceeded && connectionType !== "manual") {
        throw new createCallable_1.HttpsError("failed-precondition", "Automated file matching is disabled for over-quota transactions.");
    }
    // Check if connection already exists
    const existingQuery = await ctx.db
        .collection("fileConnections")
        .where("fileId", "==", fileId)
        .where("transactionId", "==", transactionId)
        .where("userId", "==", ctx.userId)
        .limit(1)
        .get();
    if (!existingQuery.empty) {
        return {
            success: true,
            connectionId: existingQuery.docs[0].id,
            alreadyConnected: true,
        };
    }
    // Cancel running automation when user manually connects
    if (connectionType === "manual") {
        // Cancel file search workers for this transaction
        (0, cancelWorkers_1.cancelFileWorkersForTransaction)(ctx.userId, transactionId).catch((err) => {
            console.error("[connectFileToTransaction] Failed to cancel transaction workers:", err);
        });
        // Cancel transaction matching workers for this file
        (0, cancelWorkers_1.cancelTransactionWorkersForFile)(ctx.userId, fileId).catch((err) => {
            console.error("[connectFileToTransaction] Failed to cancel file workers:", err);
        });
        // Cancel precision search queue for this transaction
        (0, cancelWorkers_1.cancelPrecisionSearchForTransaction)(ctx.userId, transactionId).catch((err) => {
            console.error("[connectFileToTransaction] Failed to cancel precision search:", err);
        });
    }
    const now = firestore_1.Timestamp.now();
    const batch = ctx.db.batch();
    let reassignedConnections = 0;
    const isAutoConnectionType = (value) => value === "auto_matched" || value === "ai_matched";
    // Optional safety mode for agentic flows: reassign existing auto connections.
    // This allows better matches to replace older auto links while preserving
    // manual/user-confirmed decisions.
    if (allowAutoReassign) {
        const [txConnectionsSnap, fileConnectionsSnap] = await Promise.all([
            ctx.db
                .collection("fileConnections")
                .where("transactionId", "==", transactionId)
                .where("userId", "==", ctx.userId)
                .get(),
            ctx.db
                .collection("fileConnections")
                .where("fileId", "==", fileId)
                .where("userId", "==", ctx.userId)
                .get(),
        ]);
        const lockedTxConnections = txConnectionsSnap.docs.filter((doc) => {
            const data = doc.data();
            if (data.fileId === fileId)
                return false;
            return !isAutoConnectionType(data.connectionType);
        });
        if (lockedTxConnections.length > 0) {
            throw new createCallable_1.HttpsError("failed-precondition", "Transaction has manual/user-confirmed file matches; refusing auto reassignment.");
        }
        const lockedFileConnections = fileConnectionsSnap.docs.filter((doc) => {
            const data = doc.data();
            if (data.transactionId === transactionId)
                return false;
            return !isAutoConnectionType(data.connectionType);
        });
        if (lockedFileConnections.length > 0) {
            throw new createCallable_1.HttpsError("failed-precondition", "File has manual/user-confirmed transaction matches; refusing auto reassignment.");
        }
        const staleAutoById = new Map();
        for (const doc of txConnectionsSnap.docs) {
            const data = doc.data();
            if (data.fileId === fileId)
                continue;
            if (isAutoConnectionType(data.connectionType)) {
                staleAutoById.set(doc.id, doc);
            }
        }
        for (const doc of fileConnectionsSnap.docs) {
            const data = doc.data();
            if (data.transactionId === transactionId)
                continue;
            if (isAutoConnectionType(data.connectionType)) {
                staleAutoById.set(doc.id, doc);
            }
        }
        if (staleAutoById.size > 0) {
            const removeTxIdsByFile = new Map();
            const removeFileIdsByTx = new Map();
            for (const staleDoc of staleAutoById.values()) {
                const staleData = staleDoc.data();
                const staleFileId = staleData.fileId;
                const staleTransactionId = staleData.transactionId;
                if (!staleFileId || !staleTransactionId)
                    continue;
                if (!removeTxIdsByFile.has(staleFileId)) {
                    removeTxIdsByFile.set(staleFileId, new Set());
                }
                removeTxIdsByFile.get(staleFileId).add(staleTransactionId);
                if (!removeFileIdsByTx.has(staleTransactionId)) {
                    removeFileIdsByTx.set(staleTransactionId, new Set());
                }
                removeFileIdsByTx.get(staleTransactionId).add(staleFileId);
                batch.delete(staleDoc.ref);
            }
            for (const [staleFileId, staleTxIds] of removeTxIdsByFile.entries()) {
                batch.update(ctx.db.collection("files").doc(staleFileId), {
                    transactionIds: firestore_1.FieldValue.arrayRemove(...Array.from(staleTxIds)),
                    updatedAt: now,
                });
            }
            for (const [staleTransactionId, staleFileIds] of removeFileIdsByTx.entries()) {
                const staleTxRef = ctx.db.collection("transactions").doc(staleTransactionId);
                const staleTxSnap = await staleTxRef.get();
                const staleTxData = staleTxSnap.exists ? staleTxSnap.data() || {} : {};
                const existingFileIds = Array.isArray(staleTxData.fileIds) ? staleTxData.fileIds : [];
                const remainingFileIds = existingFileIds.filter((id) => !staleFileIds.has(id));
                const hasNoReceiptCategory = !!staleTxData.noReceiptCategoryId;
                const staleUpdates = {
                    fileIds: firestore_1.FieldValue.arrayRemove(...Array.from(staleFileIds)),
                    updatedAt: now,
                };
                if (staleTransactionId !== transactionId && remainingFileIds.length === 0 && !hasNoReceiptCategory) {
                    staleUpdates.isComplete = false;
                }
                batch.update(staleTxRef, staleUpdates);
            }
            reassignedConnections = staleAutoById.size;
        }
    }
    // Check if this transaction was in file's suggestions (for tracking accuracy)
    const suggestions = fileData.transactionSuggestions || [];
    const suggestedIndex = suggestions.findIndex((s) => s.transactionId === transactionId);
    const wasSuggested = suggestedIndex >= 0;
    const suggestedConfidence = wasSuggested
        ? suggestions[suggestedIndex].confidence
        : null;
    const suggestedRank = wasSuggested ? suggestedIndex : null;
    // 1. Create junction document
    const connectionRef = ctx.db.collection("fileConnections").doc();
    const connectionData = {
        fileId,
        transactionId,
        userId: ctx.userId,
        connectionType,
        matchConfidence: matchConfidence ?? null,
        wasSuggested,
        suggestedConfidence,
        suggestedRank,
        createdAt: now,
    };
    // Add source tracking fields if provided
    if (sourceInfo?.sourceType) {
        connectionData.sourceType = sourceInfo.sourceType;
    }
    if (sourceInfo?.searchPattern) {
        connectionData.searchPattern = sourceInfo.searchPattern;
    }
    if (sourceInfo?.gmailIntegrationId) {
        connectionData.gmailIntegrationId = sourceInfo.gmailIntegrationId;
    }
    if (sourceInfo?.gmailIntegrationEmail) {
        connectionData.gmailIntegrationEmail = sourceInfo.gmailIntegrationEmail;
    }
    if (sourceInfo?.gmailMessageId) {
        connectionData.gmailMessageId = sourceInfo.gmailMessageId;
    }
    if (sourceInfo?.gmailMessageFrom) {
        connectionData.gmailMessageFrom = sourceInfo.gmailMessageFrom;
    }
    if (sourceInfo?.gmailMessageFromName) {
        connectionData.gmailMessageFromName = sourceInfo.gmailMessageFromName;
    }
    if (sourceInfo?.resultType) {
        connectionData.resultType = sourceInfo.resultType;
    }
    batch.set(connectionRef, connectionData);
    // 2. Update file's transactionIds array
    const fileUpdate = {
        transactionIds: firestore_1.FieldValue.arrayUnion(transactionId),
        updatedAt: now,
    };
    // 3. Update transaction's fileIds array and mark as complete
    const actor = connectionType === "manual" ? "manual" : "auto";
    const sourceTypeLabel = sourceInfo?.sourceType || "search";
    const searchPattern = sourceInfo?.searchPattern?.trim();
    const summary = searchPattern
        ? `File "${fileData.fileName || fileId}" connected (found via ${sourceTypeLabel}: "${searchPattern}")`
        : `File "${fileData.fileName || fileId}" connected`;
    const transactionUpdate = {
        fileIds: firestore_1.FieldValue.arrayUnion(fileId),
        isComplete: true,
        updatedAt: now,
        automationHistory: firestore_1.FieldValue.arrayUnion({
            type: "file_connected",
            ranAt: now,
            status: "completed",
            actor,
            level: (0, activityLevel_1.deriveActivityLevel)({ type: "file_connected", actor }),
            fileId,
            fileName: fileData.fileName || null,
            confidence: matchConfidence ?? null,
            summary,
        }),
    };
    // 4. Partner sync logic - FILE TAKES PRECEDENCE (it's the actual document)
    // Exception: Manual assignments on transaction are respected
    //
    // Priority (highest to lowest):
    // 1. Manual assignment on transaction (user explicitly chose) - always respected
    // 2. File's partner (actual document with extracted company name)
    // 3. Transaction's auto-matched partner (bank data guessing)
    //
    // We store the original transaction partner as bankPartnerId for audit trail
    const filePartnerId = fileData.partnerId;
    const filePartnerConfidence = fileData.partnerMatchConfidence ?? 0;
    const transactionPartnerId = transactionData.partnerId;
    const transactionPartnerMatchedBy = transactionData.partnerMatchedBy;
    const transactionWasManual = transactionPartnerMatchedBy === "manual";
    if (filePartnerId && !transactionPartnerId) {
        // File has partner, transaction doesn't -> sync to transaction
        transactionUpdate.partnerId = filePartnerId;
        transactionUpdate.partnerType = fileData.partnerType ?? "user";
        transactionUpdate.partnerMatchConfidence = filePartnerConfidence;
        transactionUpdate.partnerMatchedBy = "auto"; // Synced from file
        console.log(`[connectFileToTransaction] Synced partner ${filePartnerId} from file to transaction`);
    }
    else if (transactionPartnerId && !filePartnerId) {
        // Transaction has partner, file doesn't -> sync to file
        fileUpdate.partnerId = transactionPartnerId;
        fileUpdate.partnerType = transactionData.partnerType ?? "user";
        fileUpdate.partnerMatchConfidence = transactionData.partnerMatchConfidence ?? 0;
        console.log(`[connectFileToTransaction] Synced partner ${transactionPartnerId} from transaction to file`);
    }
    else if (filePartnerId && transactionPartnerId && filePartnerId !== transactionPartnerId) {
        // Both have different partners - FILE WINS unless transaction was manual
        if (transactionWasManual) {
            // Respect manual assignment - sync transaction's partner to file instead
            fileUpdate.partnerId = transactionPartnerId;
            fileUpdate.partnerType = transactionData.partnerType ?? "user";
            fileUpdate.partnerMatchConfidence = transactionData.partnerMatchConfidence ?? 0;
            console.log(`[connectFileToTransaction] Transaction partner ${transactionPartnerId} (manual) respected, synced to file`);
        }
        else {
            // File wins - store original as bankPartnerId for audit trail
            transactionUpdate.bankPartnerId = transactionPartnerId;
            transactionUpdate.bankPartnerType = transactionData.partnerType ?? null;
            transactionUpdate.bankPartnerMatchedBy = transactionPartnerMatchedBy ?? null;
            transactionUpdate.bankPartnerMatchConfidence = transactionData.partnerMatchConfidence ?? null;
            // Override with file's partner
            transactionUpdate.partnerId = filePartnerId;
            transactionUpdate.partnerType = fileData.partnerType ?? "user";
            transactionUpdate.partnerMatchConfidence = filePartnerConfidence;
            transactionUpdate.partnerMatchedBy = "auto"; // Synced from file
            console.log(`[connectFileToTransaction] File partner ${filePartnerId} wins over transaction partner ${transactionPartnerId} (stored as bankPartnerId)`);
        }
    }
    batch.update(fileRef, fileUpdate);
    batch.update(transactionRef, transactionUpdate);
    await batch.commit();
    console.log(`[connectFileToTransaction] Connected file ${fileId} to transaction ${transactionId}`);
    // === LEARN SOURCE PATTERNS ON PARTNER ===
    // After successful connection, store source patterns for future matching/search hints.
    const finalPartnerId = transactionUpdate.partnerId || transactionPartnerId || filePartnerId;
    const normalizedSearchPattern = sourceInfo?.searchPattern?.trim();
    if (finalPartnerId && (sourceInfo?.gmailMessageFrom || normalizedSearchPattern)) {
        const senderDomain = sourceInfo?.gmailMessageFrom
            ? extractEmailDomain(sourceInfo.gmailMessageFrom)
            : null;
        try {
            const partnerRef = ctx.db.collection("partners").doc(finalPartnerId);
            const partnerSnap = await partnerRef.get();
            if (partnerSnap.exists && partnerSnap.data()?.userId === ctx.userId) {
                const partnerData = partnerSnap.data();
                const nowTs = firestore_1.Timestamp.now();
                const updates = {
                    updatedAt: nowTs,
                };
                let shouldUpdatePartner = false;
                const existingDomains = partnerData.emailDomains || [];
                if (senderDomain && !existingDomains.includes(senderDomain)) {
                    updates.emailDomains = firestore_1.FieldValue.arrayUnion(senderDomain);
                    updates.emailDomainsUpdatedAt = nowTs;
                    shouldUpdatePartner = true;
                    console.log(`[connectFileToTransaction] Learned email domain "${senderDomain}" for partner ${finalPartnerId}`);
                }
                const existingPatterns = (partnerData.fileSourcePatterns || []);
                const nextPatterns = [...existingPatterns];
                const filenameExample = typeof fileData.fileName === "string" ? fileData.fileName : undefined;
                let patternsChanged = false;
                // Legacy Gmail domain pattern learning (from:{domain}) with upsert semantics.
                if (senderDomain) {
                    const domainPattern = {
                        sourceType: "gmail",
                        pattern: `from:${senderDomain}`,
                        integrationId: sourceInfo?.gmailIntegrationId || null,
                        resultType: "gmail_attachment",
                        confidence: 80,
                        usageCount: 1,
                        sourceTransactionIds: [transactionId],
                        filenameExamples: filenameExample ? [filenameExample] : [],
                        createdAt: nowTs,
                        lastUsedAt: nowTs,
                        fromDomain: senderDomain,
                    };
                    patternsChanged = upsertPattern(nextPatterns, domainPattern, transactionId, filenameExample, (p) => {
                        const sameSource = (p.sourceType || "").toLowerCase() === "gmail";
                        const sameIntegration = (p.integrationId || null) === (sourceInfo?.gmailIntegrationId || null);
                        const patternMatch = (p.pattern || "").toLowerCase() === `from:${senderDomain}` || p.fromDomain === senderDomain;
                        return sameSource && sameIntegration && patternMatch;
                    }) || patternsChanged;
                }
                // Learn the actual search query that found this file.
                if (normalizedSearchPattern) {
                    const querySourceType = sourceInfo?.sourceType || "gmail";
                    const queryResultType = sourceInfo?.resultType || "gmail_attachment";
                    const queryPattern = {
                        sourceType: querySourceType,
                        pattern: normalizedSearchPattern,
                        integrationId: sourceInfo?.gmailIntegrationId || null,
                        resultType: queryResultType,
                        confidence: 85,
                        usageCount: 1,
                        sourceTransactionIds: [transactionId],
                        filenameExamples: filenameExample ? [filenameExample] : [],
                        createdAt: nowTs,
                        lastUsedAt: nowTs,
                    };
                    patternsChanged = upsertPattern(nextPatterns, queryPattern, transactionId, filenameExample, (p) => {
                        const sameSource = (p.sourceType || "").toLowerCase() === querySourceType.toLowerCase();
                        const samePattern = (p.pattern || "").toLowerCase() === normalizedSearchPattern.toLowerCase();
                        const sameIntegration = (p.integrationId || null) === (sourceInfo?.gmailIntegrationId || null);
                        const sameResultType = (p.resultType || null) === (queryResultType || null);
                        return sameSource && samePattern && sameIntegration && sameResultType;
                    }) || patternsChanged;
                }
                if (patternsChanged) {
                    updates.fileSourcePatterns = nextPatterns;
                    updates.fileSourcePatternsUpdatedAt = nowTs;
                    shouldUpdatePartner = true;
                }
                if (shouldUpdatePartner) {
                    await partnerRef.update(updates);
                }
            }
        }
        catch (learnErr) {
            // Don't fail the connection if pattern learning fails
            console.error(`[connectFileToTransaction] Failed to learn source patterns:`, learnErr);
        }
    }
    return {
        success: true,
        connectionId: connectionRef.id,
        alreadyConnected: false,
        reassignedConnections,
    };
});
/**
 * Extract domain from email address
 */
function extractEmailDomain(email) {
    if (!email)
        return null;
    const match = email.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
    return match ? match[1] : null;
}
function upsertPattern(patterns, incoming, transactionId, filenameExample, matcher) {
    const nowTs = firestore_1.Timestamp.now();
    const index = patterns.findIndex(matcher);
    if (index >= 0) {
        const current = patterns[index];
        const mergedTxIds = appendUnique(current.sourceTransactionIds || [], transactionId, 20);
        const mergedFilenames = filenameExample
            ? appendUnique(current.filenameExamples || [], filenameExample, 10)
            : (current.filenameExamples || []);
        patterns[index] = {
            ...current,
            sourceType: incoming.sourceType || current.sourceType,
            pattern: incoming.pattern || current.pattern,
            integrationId: incoming.integrationId ?? current.integrationId ?? null,
            resultType: incoming.resultType || current.resultType,
            confidence: Math.max(current.confidence || 0, incoming.confidence || 0),
            usageCount: (current.usageCount || 0) + 1,
            sourceTransactionIds: mergedTxIds,
            filenameExamples: mergedFilenames,
            createdAt: current.createdAt || nowTs,
            lastUsedAt: nowTs,
            fromDomain: incoming.fromDomain || current.fromDomain,
        };
        return true;
    }
    patterns.push({
        ...incoming,
        usageCount: 1,
        sourceTransactionIds: [transactionId],
        filenameExamples: filenameExample ? [filenameExample] : incoming.filenameExamples || [],
        createdAt: incoming.createdAt || nowTs,
        lastUsedAt: nowTs,
    });
    return true;
}
function appendUnique(existing, next, maxItems) {
    const merged = [...existing.filter(Boolean)];
    if (!merged.includes(next)) {
        merged.push(next);
    }
    return merged.slice(-maxItems);
}
//# sourceMappingURL=connectFileToTransaction.js.map