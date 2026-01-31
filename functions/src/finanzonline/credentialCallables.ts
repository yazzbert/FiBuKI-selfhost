/**
 * Cloud Functions for FinanzOnline credential management
 *
 * Handles secure storage and testing of FinanzOnline WebService credentials.
 * PINs are encrypted at rest using AES-256-GCM.
 */

import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import { encrypt, decrypt } from "../utils/encryption";
import { testConnection } from "./soapClient";
import type {
  SaveCredentialsRequest,
  SaveCredentialsResponse,
  TestConnectionResponse,
  FinanzOnlineCredentialsDocument,
} from "../types/finanzonline";

// ============================================================================
// Secrets
// ============================================================================

/**
 * Encryption key for FinanzOnline PINs
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Set with: firebase functions:secrets:set FINANZONLINE_ENCRYPTION_KEY
 */
const FINANZONLINE_ENCRYPTION_KEY = defineSecret("FINANZONLINE_ENCRYPTION_KEY");

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
export const saveFinanzOnlineCredentialsCallable = createCallable<
  SaveCredentialsRequest,
  SaveCredentialsResponse
>(
  {
    name: "saveFinanzOnlineCredentials",
    secrets: [FINANZONLINE_ENCRYPTION_KEY],
  },
  async (ctx, request) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
      throw new HttpsError(
        "permission-denied",
        "FinanzOnline integration is currently admin-only"
      );
    }

    const { teilnehmerId, benutzerId, pin } = request;

    // Validate inputs
    if (!teilnehmerId || teilnehmerId.length < 6 || teilnehmerId.length > 12) {
      throw new HttpsError(
        "invalid-argument",
        "Teilnehmer-ID must be 6-12 characters"
      );
    }

    if (!benutzerId || benutzerId.length < 1 || benutzerId.length > 20) {
      throw new HttpsError(
        "invalid-argument",
        "Benutzer-ID must be 1-20 characters"
      );
    }

    if (!pin || pin.length < 4) {
      throw new HttpsError(
        "invalid-argument",
        "PIN must be at least 4 characters"
      );
    }

    // Get encryption key
    const encryptionKey = FINANZONLINE_ENCRYPTION_KEY.value();
    if (!encryptionKey || encryptionKey.length !== 64) {
      console.error("[FinanzOnline] Encryption key not configured properly");
      throw new HttpsError(
        "failed-precondition",
        "FinanzOnline encryption not configured. Please contact support."
      );
    }

    // Encrypt PIN
    const { encrypted: encryptedPin, iv } = encrypt(pin, encryptionKey);

    // Store encrypted credentials (server-only collection)
    const credentialsDoc: Omit<
      FinanzOnlineCredentialsDocument,
      "createdAt" | "updatedAt"
    > & {
      createdAt: FieldValue;
      updatedAt: FieldValue;
    } = {
      userId: ctx.userId,
      teilnehmerId,
      benutzerId,
      encryptedPin,
      iv,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
      .set(
        {
          finanzonline: {
            isConfigured: true,
            teilnehmerId,
            benutzerId,
            connectionStatus: "untested",
            lastError: null,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    console.log(
      `[FinanzOnline] Credentials saved for user ${ctx.userId}, Teilnehmer ${teilnehmerId}`
    );

    return { success: true };
  }
);

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
export const testFinanzOnlineConnectionCallable = createCallable<
  Record<string, never>, // No request params needed
  TestConnectionResponse
>(
  {
    name: "testFinanzOnlineConnection",
    secrets: [FINANZONLINE_ENCRYPTION_KEY],
    timeoutSeconds: 30, // SOAP calls can be slow
  },
  async (ctx) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
      throw new HttpsError(
        "permission-denied",
        "FinanzOnline integration is currently admin-only"
      );
    }

    // Load credentials
    const credentialsDoc = await ctx.db
      .collection("finanzonlineCredentials")
      .doc(ctx.userId)
      .get();

    if (!credentialsDoc.exists) {
      throw new HttpsError(
        "not-found",
        "No FinanzOnline credentials configured. Please save credentials first."
      );
    }

    const credentials = credentialsDoc.data() as FinanzOnlineCredentialsDocument;

    // Get encryption key
    const encryptionKey = FINANZONLINE_ENCRYPTION_KEY.value();
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new HttpsError(
        "failed-precondition",
        "FinanzOnline encryption not configured"
      );
    }

    // Decrypt PIN
    let pin: string;
    try {
      pin = decrypt(credentials.encryptedPin, credentials.iv, encryptionKey);
    } catch (error) {
      console.error("[FinanzOnline] Failed to decrypt PIN:", error);
      throw new HttpsError(
        "internal",
        "Failed to decrypt credentials. Please re-save your credentials."
      );
    }

    // Test connection
    console.log(
      `[FinanzOnline] Testing connection for Teilnehmer ${credentials.teilnehmerId}`
    );

    const result = await testConnection({
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
      .set(
        {
          finanzonline: {
            connectionStatus: result.success ? "valid" : "invalid",
            lastError: result.error || null,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    console.log(
      `[FinanzOnline] Connection test result: ${result.success ? "success" : "failed"}`
    );

    return result;
  }
);

// ============================================================================
// Delete Credentials
// ============================================================================

/**
 * Delete FinanzOnline credentials
 *
 * - Removes encrypted credentials
 * - Clears public metadata from userData
 */
export const deleteFinanzOnlineCredentialsCallable = createCallable<
  Record<string, never>,
  { success: boolean }
>(
  {
    name: "deleteFinanzOnlineCredentials",
  },
  async (ctx) => {
    // Admin-only while feature is being hardened
    const isAdmin = ctx.request.auth?.token?.admin === true;
    if (!isAdmin) {
      throw new HttpsError(
        "permission-denied",
        "FinanzOnline integration is currently admin-only"
      );
    }

    // Delete encrypted credentials
    await ctx.db.collection("finanzonlineCredentials").doc(ctx.userId).delete();

    // Clear public metadata
    await ctx.db
      .collection("users")
      .doc(ctx.userId)
      .collection("settings")
      .doc("userData")
      .set(
        {
          finanzonline: {
            isConfigured: false,
            teilnehmerId: null,
            benutzerId: null,
            connectionStatus: null,
            lastError: null,
            lastSubmissionAt: null,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    console.log(`[FinanzOnline] Credentials deleted for user ${ctx.userId}`);

    return { success: true };
  }
);
