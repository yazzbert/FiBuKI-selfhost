"use strict";
/**
 * Cloud Function: Submit UVA to FinanzOnline
 *
 * Handles the complete UVA submission flow:
 * 1. Load & decrypt credentials
 * 2. Generate UVA XML
 * 3. SOAP: Session login
 * 4. SOAP: File upload
 * 5. SOAP: Session logout
 * 6. Store submission record
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitUvaToFinanzOnlineCallable = void 0;
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const encryption_1 = require("../utils/encryption");
const encryption_2 = require("../utils/encryption");
const soapClient_1 = require("./soapClient");
const generateUvaXml_1 = require("../reports/generateUvaXml");
// ============================================================================
// Secrets
// ============================================================================
const FINANZONLINE_ENCRYPTION_KEY = (0, params_1.defineSecret)("FINANZONLINE_ENCRYPTION_KEY");
// ============================================================================
// Environment Configuration
// ============================================================================
/**
 * Set to 'T' for test environment, 'P' for production
 * Can be configured via environment variable
 */
const SUBMISSION_MODE = process.env.FINANZONLINE_MODE || "T";
// ============================================================================
// Submit UVA Callable
// ============================================================================
exports.submitUvaToFinanzOnlineCallable = (0, createCallable_1.createCallable)({
    name: "submitUvaToFinanzOnline",
    secrets: [FINANZONLINE_ENCRYPTION_KEY],
    timeoutSeconds: 60, // SOAP calls can be slow
    memory: "512MiB",
}, async (ctx, request) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
        throw new createCallable_1.HttpsError("permission-denied", "FinanzOnline integration is currently admin-only");
    }
    const { report, period, taxNumber } = request;
    // ========================================================================
    // Validate inputs
    // ========================================================================
    if (!taxNumber || !/^\d{9}$/.test(taxNumber)) {
        throw new createCallable_1.HttpsError("invalid-argument", "Tax number (FASTNR) must be exactly 9 digits");
    }
    if (!report) {
        throw new createCallable_1.HttpsError("invalid-argument", "Report data is required");
    }
    if (!period) {
        throw new createCallable_1.HttpsError("invalid-argument", "Period is required");
    }
    // ========================================================================
    // Load credentials
    // ========================================================================
    const credentialsDoc = await ctx.db
        .collection("finanzonlineCredentials")
        .doc(ctx.userId)
        .get();
    if (!credentialsDoc.exists) {
        throw new createCallable_1.HttpsError("failed-precondition", "FinanzOnline credentials not configured. Please set up your credentials in Settings > Integrations.");
    }
    const credentials = credentialsDoc.data();
    // Get encryption key
    const encryptionKey = FINANZONLINE_ENCRYPTION_KEY.value();
    if (!encryptionKey || encryptionKey.length !== 64) {
        throw new createCallable_1.HttpsError("failed-precondition", "FinanzOnline encryption not configured");
    }
    // Decrypt PIN
    let pin;
    try {
        pin = (0, encryption_1.decrypt)(credentials.encryptedPin, credentials.iv, encryptionKey);
    }
    catch (error) {
        console.error("[FinanzOnline] Failed to decrypt PIN:", error);
        throw new createCallable_1.HttpsError("internal", "Failed to decrypt credentials. Please re-save your credentials.");
    }
    // ========================================================================
    // Generate XML
    // ========================================================================
    console.log(`[FinanzOnline] Generating UVA XML for ${period.year}-${period.period} (${period.type})`);
    const xml = (0, generateUvaXml_1.generateUvaXml)(report, period, taxNumber);
    const xmlHash = (0, encryption_2.sha256)(xml);
    // ========================================================================
    // Create submission record (pending)
    // ========================================================================
    const submissionRef = ctx.db.collection("finanzonlineSubmissions").doc();
    const submissionId = submissionRef.id;
    await submissionRef.set({
        id: submissionId,
        userId: ctx.userId,
        periodYear: period.year,
        periodNumber: period.period,
        periodType: period.type,
        taxNumber,
        xmlHash,
        status: "pending",
        submittedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // ========================================================================
    // SOAP: Login
    // ========================================================================
    let sessionId = null;
    try {
        console.log(`[FinanzOnline] Logging in...`);
        const loginResult = await (0, soapClient_1.sessionLogin)({
            teilnehmerId: credentials.teilnehmerId,
            benutzerId: credentials.benutzerId,
            pin,
        });
        if (!(0, soapClient_1.isSuccess)(loginResult.returnCode) || !loginResult.sessionId) {
            const errorMsg = loginResult.message || (0, soapClient_1.getErrorMessage)(loginResult.returnCode);
            await submissionRef.update({
                status: "failed",
                errorMessage: `Login failed: ${errorMsg}`,
            });
            throw new createCallable_1.HttpsError("unauthenticated", `FinanzOnline login failed: ${errorMsg}`);
        }
        sessionId = loginResult.sessionId;
        console.log(`[FinanzOnline] Login successful`);
        // ======================================================================
        // SOAP: Upload
        // ======================================================================
        console.log(`[FinanzOnline] Uploading UVA (mode: ${SUBMISSION_MODE})...`);
        const uploadResult = await (0, soapClient_1.uploadFile)({
            sessionId,
            teilnehmerId: credentials.teilnehmerId,
            benutzerId: credentials.benutzerId,
            art: "U30", // UVA declaration type
            uebermittlung: SUBMISSION_MODE,
            xmlData: xml,
        });
        if (!(0, soapClient_1.isSuccess)(uploadResult.returnCode)) {
            const errorMsg = uploadResult.message || (0, soapClient_1.getErrorMessage)(uploadResult.returnCode);
            await submissionRef.update({
                status: "failed",
                errorMessage: `Upload failed: ${errorMsg}`,
            });
            throw new createCallable_1.HttpsError("internal", `FinanzOnline upload failed: ${errorMsg}`);
        }
        // ======================================================================
        // Success!
        // ======================================================================
        const referenceNumber = uploadResult.referenceNumber || undefined;
        console.log(`[FinanzOnline] Upload successful! Reference: ${referenceNumber || "none"}`);
        // Update submission record
        await submissionRef.update({
            status: "success",
            referenceNumber: referenceNumber || null,
        });
        // Update last submission timestamp in userData
        await ctx.db
            .collection("users")
            .doc(ctx.userId)
            .collection("settings")
            .doc("userData")
            .set({
            finanzonline: {
                lastSubmissionAt: firestore_1.FieldValue.serverTimestamp(),
            },
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        return {
            success: true,
            referenceNumber,
            submissionId,
        };
    }
    catch (error) {
        // Ensure we logout on any error
        if (sessionId) {
            await (0, soapClient_1.sessionLogout)(sessionId, credentials.teilnehmerId, credentials.benutzerId).catch(() => { });
        }
        // Re-throw HttpsError as-is
        if (error instanceof createCallable_1.HttpsError) {
            throw error;
        }
        // Update submission record with error
        await submissionRef.update({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
        console.error("[FinanzOnline] Submission error:", error);
        throw new createCallable_1.HttpsError("internal", error instanceof Error ? error.message : "FinanzOnline submission failed");
    }
    finally {
        // Always try to logout
        if (sessionId) {
            await (0, soapClient_1.sessionLogout)(sessionId, credentials.teilnehmerId, credentials.benutzerId).catch(() => { });
        }
    }
});
//# sourceMappingURL=submitUvaCallable.js.map