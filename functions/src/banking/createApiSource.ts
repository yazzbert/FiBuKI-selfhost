/**
 * Create an API-connected source (for banking integrations)
 *
 * Creates a source with apiConfig for finAPI or other banking providers.
 * Optionally triggers initial sync after creation.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import {
  CreateApiSourceRequest,
  CreateApiSourceResponse,
} from "../types/banking-sync";

/**
 * Normalize IBAN by removing spaces and converting to uppercase
 */
function normalizeIban(iban: string): string {
  return iban.replace(/\s/g, "").toUpperCase();
}

export const createApiSourceCallable = createCallable<
  CreateApiSourceRequest,
  CreateApiSourceResponse
>(
  { name: "createApiSource" },
  async (ctx, request) => {
    const { name, accountKind, iban, currency, apiConfig, connectionId } = request;

    // Validate required fields
    if (!name?.trim()) {
      throw new HttpsError("invalid-argument", "Source name is required");
    }
    if (!currency) {
      throw new HttpsError("invalid-argument", "Currency is required");
    }
    if (!apiConfig || !apiConfig.provider) {
      throw new HttpsError("invalid-argument", "apiConfig with provider is required");
    }

    // Check for existing source with same accountId (prevent duplicates)
    if (apiConfig.accountId) {
      const existingQuery = await ctx.db
        .collection("sources")
        .where("userId", "==", ctx.userId)
        .where("apiConfig.accountId", "==", apiConfig.accountId)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        throw new HttpsError(
          "already-exists",
          "This account is already connected",
          { sourceId: existingQuery.docs[0].id }
        );
      }
    }

    const now = Timestamp.now();

    // Prepare apiConfig with proper timestamp handling
    const preparedApiConfig: Record<string, unknown> = {
      ...apiConfig,
    };

    // Convert date strings to Timestamps
    if (apiConfig.tokenExpiresAt) {
      preparedApiConfig.tokenExpiresAt = apiConfig.tokenExpiresAt instanceof Date
        ? Timestamp.fromDate(apiConfig.tokenExpiresAt)
        : Timestamp.fromDate(new Date(apiConfig.tokenExpiresAt as string));
    }
    if (apiConfig.expiresAt) {
      preparedApiConfig.expiresAt = apiConfig.expiresAt instanceof Date
        ? Timestamp.fromDate(apiConfig.expiresAt)
        : Timestamp.fromDate(new Date(apiConfig.expiresAt as string));
    }
    if (apiConfig.lastSyncAt === null) {
      preparedApiConfig.lastSyncAt = null;
    }

    const sourceData = {
      name: name.trim(),
      accountKind: accountKind || "bank_account",
      iban: iban ? normalizeIban(iban) : null,
      currency,
      type: "api",
      apiConfig: preparedApiConfig,
      isActive: true,
      userId: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await ctx.db.collection("sources").add(sourceData);
    const sourceId = docRef.id;

    console.log(`[createApiSource] Created source ${sourceId}`, {
      userId: ctx.userId,
      provider: apiConfig.provider,
      accountId: apiConfig.accountId,
    });

    // If connectionId provided, update the connection to link it
    if (connectionId) {
      try {
        await ctx.db.collection("bankingConnections").doc(connectionId).update({
          linkedSourceId: sourceId,
          updatedAt: now,
        });
        console.log(`[createApiSource] Linked to connection ${connectionId}`);
      } catch (err) {
        // Non-fatal - connection might not exist
        console.warn(`[createApiSource] Failed to link to connection ${connectionId}:`, err);
      }
    }

    return {
      success: true,
      sourceId,
    };
  }
);
