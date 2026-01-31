/**
 * Create a new banking connection
 *
 * Called when a user initiates a bank connection through finAPI or other provider.
 * Stores the connection metadata and auth URL for the user to complete.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";
import {
  CreateBankingConnectionRequest,
  CreateBankingConnectionResponse,
} from "../types/banking-sync";

export const createBankingConnectionCallable = createCallable<
  CreateBankingConnectionRequest,
  CreateBankingConnectionResponse
>(
  { name: "createBankingConnection" },
  async (ctx, request) => {
    const {
      providerId,
      providerConnectionId,
      institutionId,
      institutionName,
      institutionLogo,
      authUrl,
      expiresAt,
      providerData,
      linkToSourceId,
    } = request;

    // Validate required fields
    if (!providerId) {
      throw new HttpsError("invalid-argument", "providerId is required");
    }
    if (!providerConnectionId) {
      throw new HttpsError("invalid-argument", "providerConnectionId is required");
    }
    if (!institutionId) {
      throw new HttpsError("invalid-argument", "institutionId is required");
    }
    if (!institutionName) {
      throw new HttpsError("invalid-argument", "institutionName is required");
    }
    if (!authUrl) {
      throw new HttpsError("invalid-argument", "authUrl is required");
    }
    if (!expiresAt) {
      throw new HttpsError("invalid-argument", "expiresAt is required");
    }

    const now = Timestamp.now();

    const connectionDoc = {
      providerId,
      providerConnectionId,
      institutionId,
      institutionName,
      institutionLogo: institutionLogo || null,
      status: "pending",
      authUrl,
      accountIds: [],
      expiresAt: Timestamp.fromDate(new Date(expiresAt)),
      providerData: providerData || {},
      linkToSourceId: linkToSourceId || null,
      userId: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await ctx.db.collection("bankingConnections").add(connectionDoc);

    console.log(`[createBankingConnection] Created connection ${docRef.id}`, {
      userId: ctx.userId,
      providerId,
      institutionId,
    });

    return {
      success: true,
      connectionId: docRef.id,
      authUrl,
      expiresAt,
    };
  }
);
