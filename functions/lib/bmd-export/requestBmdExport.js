"use strict";
/**
 * Callable function to initiate a BMD NTCS export.
 * Creates a bmdExports document that triggers the queue processor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestBmdExportCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const firestore_1 = require("firebase-admin/firestore");
const bmd_export_1 = require("../types/bmd-export");
exports.requestBmdExportCallable = (0, createCallable_1.createCallable)({
    name: "requestBmdExport",
    memory: "256MiB",
    timeoutSeconds: 60,
}, async (ctx, request) => {
    const { userId, db } = ctx;
    const { dateFrom, dateTo, onlyWithFiles, includeFiles } = request;
    // Validate dates
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new createCallable_1.HttpsError("invalid-argument", "Invalid date range");
    }
    if (fromDate > toDate) {
        throw new createCallable_1.HttpsError("invalid-argument", "dateFrom must be before dateTo");
    }
    // Check if there's already a pending/processing export
    const existingExport = await db
        .collection("bmdExports")
        .where("userId", "==", userId)
        .where("status", "in", ["pending", "processing"])
        .limit(1)
        .get();
    if (!existingExport.empty) {
        // Return existing export ID
        const existingDoc = existingExport.docs[0];
        return {
            success: true,
            exportId: existingDoc.id,
        };
    }
    // Create new export document
    const exportRef = db.collection("bmdExports").doc();
    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + bmd_export_1.BMD_EXPORT_EXPIRY_DAYS);
    const exportDoc = {
        userId,
        status: "pending",
        dateFrom: firestore_1.Timestamp.fromDate(fromDate),
        dateTo: firestore_1.Timestamp.fromDate(toDate),
        onlyWithFiles: onlyWithFiles ?? true,
        includeFiles: includeFiles ?? true,
        progress: {
            phase: "collecting",
            current: 0,
            total: 0,
        },
        counts: {
            transactions: 0,
            files: 0,
            partners: 0,
            kreditoren: 0,
            debitoren: 0,
        },
        retryCount: 0,
        maxRetries: 3,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    };
    await exportRef.set(exportDoc);
    console.log(`[requestBmdExport] Created BMD export ${exportRef.id} for user ${userId}, date range: ${dateFrom} to ${dateTo}`);
    return {
        success: true,
        exportId: exportRef.id,
    };
});
//# sourceMappingURL=requestBmdExport.js.map