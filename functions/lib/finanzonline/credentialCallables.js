"use strict";
/**
 * Cloud Functions for FinanzOnline credential management
 *
 * Handles secure storage and testing of FinanzOnline WebService credentials.
 * PINs are encrypted at rest using AES-256-GCM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFinanzOnlineCredentialsCallable = exports.testFinanzOnlineConnectionCallable = exports.saveFinanzOnlineCredentialsCallable = void 0;
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const createCallable_1 = require("../utils/createCallable");
const encryption_1 = require("../utils/encryption");
const soapClient_1 = require("./soapClient");
// ============================================================================
// Secrets
// ============================================================================
/**
 * Encryption key for FinanzOnline PINs
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Set with: firebase functions:secrets:set FINANZONLINE_ENCRYPTION_KEY
 */
const FINANZONLINE_ENCRYPTION_KEY = (0, params_1.defineSecret)("FINANZONLINE_ENCRYPTION_KEY");
// ============================================================================
// Save Credentials
// ============================================================================
/**
 * Save FinanzOnline WebService credentials
 *
 * - Validates credential format
 * - Encrypts PIN using AES-256-GCM
 * - Stores in server-only collection
 * - Updates public metadata in userData
 */
exports.saveFinanzOnlineCredentialsCallable = (0, createCallable_1.createCallable)({
    name: "saveFinanzOnlineCredentials",
    secrets: [FINANZONLINE_ENCRYPTION_KEY],
}, async (ctx, request) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
        throw new createCallable_1.HttpsError("permission-denied", "FinanzOnline integration is currently admin-only");
    }
    const { teilnehmerId, benutzerId, pin } = request;
    // Validate inputs
    if (!teilnehmerId || teilnehmerId.length < 6 || teilnehmerId.length > 12) {
        throw new createCallable_1.HttpsError("invalid-argument", "Teilnehmer-ID must be 6-12 characters");
    }
    if (!benutzerId || benutzerId.length < 1 || benutzerId.length > 20) {
        throw new createCallable_1.HttpsError("invalid-argument", "Benutzer-ID must be 1-20 characters");
    }
    if (!pin || pin.length < 4) {
        throw new createCallable_1.HttpsError("invalid-argument", "PIN must be at least 4 characters");
    }
    // Get encryption key
    const encryptionKey = FINANZONLINE_ENCRYPTION_KEY.value();
    if (!encryptionKey || encryptionKey.length !== 64) {
        console.error("[FinanzOnline] Encryption key not configured properly");
        throw new createCallable_1.HttpsError("failed-precondition", "FinanzOnline encryption not configured. Please contact support.");
    }
    // Encrypt PIN
    const { encrypted: encryptedPin, iv } = (0, encryption_1.encrypt)(pin, encryptionKey);
    // Store encrypted credentials (server-only collection)
    const credentialsDoc = {
        userId: ctx.userId,
        teilnehmerId,
        benutzerId,
        encryptedPin,
        iv,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    await ctx.db
        .collection("finanzonlineCredentials")
        .doc(ctx.userId)
        .set(credentialsDoc);
    // Update public metadata in userData
    await ctx.db
        .collection("users")
        .doc(ctx.userId)
        .collection("settings")
        .doc("userData")
        .set({
        finanzonline: {
            isConfigured: true,
            teilnehmerId,
            benutzerId,
            connectionStatus: "untested",
            lastError: null,
        },
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[FinanzOnline] Credentials saved for user ${ctx.userId}, Teilnehmer ${teilnehmerId}`);
    return { success: true };
});
// ============================================================================
// Test Connection
// ============================================================================
/**
 * Test FinanzOnline connection with stored credentials
 *
 * - Loads and decrypts stored credentials
 * - Attempts login/logout to verify
 * - Updates connection status in userData
 */
exports.testFinanzOnlineConnectionCallable = (0, createCallable_1.createCallable)({
    name: "testFinanzOnlineConnection",
    secrets: [FINANZONLINE_ENCRYPTION_KEY],
    timeoutSeconds: 30, // SOAP calls can be slow
}, async (ctx) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
        throw new createCallable_1.HttpsError("permission-denied", "FinanzOnline integration is currently admin-only");
    }
    // Load credentials
    const credentialsDoc = await ctx.db
        .collection("finanzonlineCredentials")
        .doc(ctx.userId)
        .get();
    if (!credentialsDoc.exists) {
        throw new createCallable_1.HttpsError("not-found", "No FinanzOnline credentials configured. Please save credentials first.");
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
    // Test connection
    console.log(`[FinanzOnline] Testing connection for Teilnehmer ${credentials.teilnehmerId}`);
    const result = await (0, soapClient_1.testConnection)({
        teilnehmerId: credentials.teilnehmerId,
        benutzerId: credentials.benutzerId,
        pin,
    });
    // Update connection status in userData
    await ctx.db
        .collection("users")
        .doc(ctx.userId)
        .collection("settings")
        .doc("userData")
        .set({
        finanzonline: {
            connectionStatus: result.success ? "valid" : "invalid",
            lastError: result.error || null,
        },
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[FinanzOnline] Connection test result: ${result.success ? "success" : "failed"}`);
    return result;
});
// ============================================================================
// Delete Credentials
// ============================================================================
/**
 * Delete FinanzOnline credentials
 *
 * - Removes encrypted credentials
 * - Clears public metadata from userData
 */
exports.deleteFinanzOnlineCredentialsCallable = (0, createCallable_1.createCallable)({
    name: "deleteFinanzOnlineCredentials",
}, async (ctx) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
        throw new createCallable_1.HttpsError("permission-denied", "FinanzOnline integration is currently admin-only");
    }
    // Delete encrypted credentials
    await ctx.db.collection("finanzonlineCredentials").doc(ctx.userId).delete();
    // Clear public metadata
    await ctx.db
        .collection("users")
        .doc(ctx.userId)
        .collection("settings")
        .doc("userData")
        .set({
        finanzonline: {
            isConfigured: false,
            teilnehmerId: null,
            benutzerId: null,
            connectionStatus: null,
            lastError: null,
            lastSubmissionAt: null,
        },
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[FinanzOnline] Credentials deleted for user ${ctx.userId}`);
    return { success: true };
});
//# sourceMappingURL=credentialCallables.js.map