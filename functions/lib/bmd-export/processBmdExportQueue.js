"use strict";
/**
 * Queue processor for BMD NTCS exports.
 * Triggers on document creation in bmdExports collection.
 * Collects transactions with files, generates BMD CSVs, creates ZIP, and uploads to Storage.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processBmdExportOnCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const crypto = __importStar(require("crypto"));
const archiver_1 = __importDefault(require("archiver"));
const stream_1 = require("stream");
const bmd_export_1 = require("../types/bmd-export");
const bmdCsvGenerators_1 = require("./bmdCsvGenerators");
const PROCESSING_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes
/**
 * Trigger: Process BMD export when document is created
 */
exports.processBmdExportOnCreate = (0, firestore_1.onDocumentCreated)({
    document: "bmdExports/{exportId}",
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 540, // 9 minutes
}, async (event) => {
    if (!event.data)
        return;
    const exportId = event.params.exportId;
    const exportData = event.data.data();
    // Only process pending exports
    if (exportData.status !== "pending") {
        console.log(`[processBmdExport] Skipping ${exportId}, status: ${exportData.status}`);
        return;
    }
    await processBmdExport(exportId, exportData);
});
/**
 * Main BMD export processing logic
 */
async function processBmdExport(exportId, exportData) {
    const db = (0, firestore_2.getFirestore)();
    const storage = (0, storage_1.getStorage)();
    const exportRef = db.collection("bmdExports").doc(exportId);
    const startTime = Date.now();
    const { userId, dateFrom, dateTo, onlyWithFiles, includeFiles } = exportData;
    console.log(`[processBmdExport] Starting export ${exportId} for user ${userId}`);
    try {
        // Mark as processing
        await exportRef.update({
            status: "processing",
            startedAt: firestore_2.FieldValue.serverTimestamp(),
            "progress.phase": "collecting",
        });
        // 1. Collect transactions in date range
        await exportRef.update({ "progress.currentEntity": "transactions" });
        const txQuery = db
            .collection("transactions")
            .where("userId", "==", userId)
            .where("date", ">=", dateFrom)
            .where("date", "<=", dateTo);
        const txSnapshot = await txQuery.get();
        let transactions = txSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
        // Filter to only complete transactions (files OR no-receipt category)
        if (onlyWithFiles) {
            transactions = transactions.filter((tx) => {
                const hasFiles = tx.fileIds && Array.isArray(tx.fileIds) && tx.fileIds.length > 0;
                const hasCategory = !!tx.noReceiptCategoryId;
                return hasFiles || hasCategory;
            });
        }
        await exportRef.update({
            "counts.transactions": transactions.length,
            "progress.currentEntity": "files",
        });
        // 2. Collect all connected files
        const allFileIds = new Set();
        transactions.forEach((tx) => {
            const fileIds = tx.fileIds;
            if (fileIds) {
                fileIds.forEach((fid) => allFileIds.add(fid));
            }
        });
        const filesMap = new Map();
        for (const fileId of allFileIds) {
            const fileDoc = await db.collection("files").doc(fileId).get();
            if (fileDoc.exists) {
                const data = fileDoc.data();
                filesMap.set(fileId, {
                    id: fileId,
                    fileName: data?.fileName || "document",
                    extractedDate: data?.extractedDate,
                    storagePath: data?.storagePath,
                });
            }
        }
        await exportRef.update({
            "counts.files": filesMap.size,
            "progress.currentEntity": "partners",
        });
        // 3. Collect all associated partners
        const partnerIds = new Set();
        transactions.forEach((tx) => {
            if (tx.partnerId)
                partnerIds.add(tx.partnerId);
        });
        const partnersMap = new Map();
        for (const partnerId of partnerIds) {
            const partnerDoc = await db.collection("partners").doc(partnerId).get();
            if (partnerDoc.exists) {
                partnersMap.set(partnerId, { id: partnerId, ...partnerDoc.data() });
            }
        }
        // Determine Kreditor vs Debitor for each partner based on transaction amounts
        const partnerTypes = new Map();
        transactions.forEach((tx) => {
            if (tx.partnerId) {
                const isExpense = tx.amount < 0;
                partnerTypes.set(tx.partnerId, isExpense ? "kreditor" : "debitor");
            }
        });
        // Prepare partners for export
        const partnersForExport = Array.from(partnersMap.values()).map((p) => ({
            id: p.id,
            name: p.name,
            street: p.street,
            postalCode: p.postalCode,
            city: p.city,
            country: p.country,
            vatId: p.vatId,
            ibans: p.ibans,
            isKreditor: partnerTypes.get(p.id) === "kreditor",
        }));
        const kreditorenCount = partnersForExport.filter((p) => p.isKreditor).length;
        const debitorenCount = partnersForExport.filter((p) => !p.isKreditor).length;
        await exportRef.update({
            "counts.partners": partnersMap.size,
            "counts.kreditoren": kreditorenCount,
            "counts.debitoren": debitorenCount,
            "progress.phase": "generating",
        });
        // Check timeout
        if (Date.now() - startTime > PROCESSING_TIMEOUT_MS) {
            throw new Error("Timeout during data collection");
        }
        // 4. Generate BMD CSVs
        const partnerIndex = new Map();
        const personenkontenCsv = (0, bmdCsvGenerators_1.generatePersonenkontenCsv)(partnersForExport, partnerIndex);
        // Prepare transactions for CSV generation
        const transactionsForExport = transactions.map((tx) => ({
            id: tx.id,
            date: tx.date,
            amount: tx.amount,
            name: tx.name,
            partner: tx.partner,
            partnerName: tx.partnerId
                ? partnersMap.get(tx.partnerId)?.name
                : undefined,
            partnerId: tx.partnerId,
            fileIds: tx.fileIds,
            vatRate: tx.vatRate,
            vatAmount: tx.vatAmount,
            vatId: tx.vatId,
            noReceiptCategoryId: tx.noReceiptCategoryId,
            noReceiptCategoryTemplateId: tx.noReceiptCategoryTemplateId,
        }));
        // Convert filesMap to simple FileForExport map
        const simpleFilesMap = new Map();
        filesMap.forEach((file, id) => {
            simpleFilesMap.set(id, {
                id: file.id,
                fileName: file.fileName,
                extractedDate: file.extractedDate,
            });
        });
        const buchungenCsv = (0, bmdCsvGenerators_1.generateBuchungenCsv)(transactionsForExport, simpleFilesMap, partnerIndex);
        await exportRef.update({
            "progress.phase": "packaging",
        });
        // 5. Create ZIP
        const zipBuffer = await createBmdZip(personenkontenCsv, buchungenCsv, filesMap, includeFiles, storage, exportRef, exportId, userId, dateFrom, dateTo, {
            transactions: transactions.length,
            files: filesMap.size,
            partners: partnersMap.size,
            kreditoren: kreditorenCount,
            debitoren: debitorenCount,
        });
        // Check timeout
        if (Date.now() - startTime > PROCESSING_TIMEOUT_MS) {
            throw new Error("Timeout during ZIP creation");
        }
        await exportRef.update({
            "progress.phase": "uploading",
        });
        // 6. Upload to Storage
        const exportDate = new Date().toISOString().split("T")[0];
        const storagePath = `bmd-exports/${userId}/${exportId}/fibuki-bmd-export-${exportDate}.zip`;
        const bucket = storage.bucket();
        const file = bucket.file(storagePath);
        // Generate a download token
        const downloadToken = crypto.randomUUID();
        await file.save(zipBuffer, {
            contentType: "application/zip",
            metadata: {
                metadata: {
                    userId,
                    exportId,
                    format: "BMD-NTCS",
                    createdAt: new Date().toISOString(),
                    firebaseStorageDownloadTokens: downloadToken,
                },
            },
        });
        // Generate download URL
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + bmd_export_1.BMD_EXPORT_EXPIRY_DAYS);
        const encodedPath = encodeURIComponent(storagePath);
        const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        let downloadUrl;
        if (storageEmulatorHost) {
            downloadUrl = `http://${storageEmulatorHost}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
        }
        else {
            downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
        }
        // Mark as completed
        await exportRef.update({
            status: "completed",
            "progress.phase": "complete",
            downloadUrl,
            storagePath,
            zipSize: zipBuffer.length,
            expiresAt: firestore_2.Timestamp.fromDate(expiresAt),
            completedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        console.log(`[processBmdExport] Completed export ${exportId}, size: ${zipBuffer.length} bytes, ${transactions.length} transactions`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[processBmdExport] Failed export ${exportId}:`, errorMessage);
        const currentRetry = exportData.retryCount || 0;
        const maxRetries = exportData.maxRetries || 3;
        if (currentRetry < maxRetries && errorMessage.includes("Timeout")) {
            // Retry on timeout
            await exportRef.update({
                status: "pending",
                retryCount: currentRetry + 1,
                error: errorMessage,
            });
        }
        else {
            // Mark as failed
            await exportRef.update({
                status: "failed",
                error: errorMessage,
                completedAt: firestore_2.FieldValue.serverTimestamp(),
            });
        }
    }
}
/**
 * Create the BMD export ZIP file
 */
async function createBmdZip(personenkontenCsv, buchungenCsv, filesMap, includeFiles, storage, exportRef, exportId, userId, dateFrom, dateTo, counts) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const passThrough = new stream_1.PassThrough();
        passThrough.on("data", (chunk) => chunks.push(chunk));
        passThrough.on("end", () => resolve(Buffer.concat(chunks)));
        passThrough.on("error", reject);
        const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
        archive.on("error", reject);
        archive.pipe(passThrough);
        // Add manifest
        const manifest = {
            version: bmd_export_1.BMD_EXPORT_FORMAT_VERSION,
            format: "BMD-NTCS",
            exportDate: new Date().toISOString(),
            userId,
            exportId,
            dateRange: {
                from: dateFrom.toDate().toISOString().split("T")[0],
                to: dateTo.toDate().toISOString().split("T")[0],
            },
            counts,
            includesFiles: includeFiles,
        };
        archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
        // Add CSVs with UTF-8 BOM for Excel compatibility
        const BOM = "\ufeff";
        archive.append(BOM + personenkontenCsv, { name: "personenkonten.csv" });
        archive.append(BOM + buchungenCsv, { name: "buchungen.csv" });
        if (includeFiles && filesMap.size > 0) {
            // Add receipt files asynchronously
            addReceiptFiles(archive, filesMap, storage, exportRef)
                .then(() => archive.finalize())
                .catch(reject);
        }
        else {
            archive.finalize();
        }
    });
}
/**
 * Add receipt files to the ZIP archive
 */
async function addReceiptFiles(archive, filesMap, storage, exportRef) {
    const bucket = storage.bucket();
    let filesAdded = 0;
    for (const [fileId, fileData] of filesMap) {
        const storagePath = fileData.storagePath;
        if (!storagePath)
            continue;
        try {
            const storageFile = bucket.file(storagePath);
            const [exists] = await storageFile.exists();
            if (exists) {
                const [metadata] = await storageFile.getMetadata();
                const fileSize = parseInt(metadata.size, 10) || 0;
                // Skip very large files (> 50MB)
                if (fileSize > 50 * 1024 * 1024) {
                    console.log(`[processBmdExport] Skipping large file: ${storagePath}`);
                    continue;
                }
                const [content] = await storageFile.download();
                // Use sanitized filename
                const safeName = fileData.fileName
                    .replace(/[^a-zA-Z0-9._-]/g, "_")
                    .substring(0, 100);
                archive.append(content, { name: `belege/${fileId}_${safeName}` });
                filesAdded++;
                if (filesAdded % 10 === 0) {
                    await exportRef.update({
                        "progress.currentEntity": `files (${filesAdded}/${filesMap.size})`,
                    });
                }
            }
        }
        catch (err) {
            console.error(`[processBmdExport] Failed to add file ${storagePath}:`, err);
        }
    }
    console.log(`[processBmdExport] Added ${filesAdded} receipt files to ZIP`);
}
//# sourceMappingURL=processBmdExportQueue.js.map