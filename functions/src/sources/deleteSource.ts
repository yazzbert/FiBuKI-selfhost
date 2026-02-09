/**
 * Delete a source and all associated imports/transactions (cascade delete)
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createCallable, HttpsError } from "../utils/createCallable";

interface DeleteSourceRequest {
  sourceId: string;
}

interface DeleteSourceResponse {
  success: boolean;
  deletedImports: number;
  deletedTransactions: number;
  deletedTrades?: number;
}

const BATCH_SIZE = 500;

export const deleteSourceCallable = createCallable<
  DeleteSourceRequest,
  DeleteSourceResponse
>(
  {
    name: "deleteSource",
    timeoutSeconds: 300, // 5 minutes for large deletions
    memory: "1GiB",
  },
  async (ctx, request) => {
    const { sourceId } = request;

    if (!sourceId) {
      throw new HttpsError("invalid-argument", "sourceId is required");
    }

    // Verify ownership
    const sourceRef = ctx.db.collection("sources").doc(sourceId);
    const sourceSnap = await sourceRef.get();

    if (!sourceSnap.exists) {
      throw new HttpsError("not-found", "Source not found");
    }

    const sourceData = sourceSnap.data()!;
    if (sourceData.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Access denied");
    }

    const now = Timestamp.now();
    let deletedImports = 0;
    let deletedTransactions = 0;
    let deletedTrades = 0;

    // 1. Clear linkedSourceId on any credit cards that link to this bank account
    const linkedCardsQuery = await ctx.db
      .collection("sources")
      .where("userId", "==", ctx.userId)
      .where("linkedSourceId", "==", sourceId)
      .get();

    if (!linkedCardsQuery.empty) {
      const batch = ctx.db.batch();
      for (const cardDoc of linkedCardsQuery.docs) {
        batch.update(cardDoc.ref, {
          linkedSourceId: null,
          updatedAt: now,
        });
      }
      await batch.commit();
    }

    // 2. Delete all imports for this source
    const importsQuery = await ctx.db
      .collection("imports")
      .where("userId", "==", ctx.userId)
      .where("sourceId", "==", sourceId)
      .get();

    if (!importsQuery.empty) {
      for (let i = 0; i < importsQuery.docs.length; i += BATCH_SIZE) {
        const batch = ctx.db.batch();
        const chunk = importsQuery.docs.slice(i, i + BATCH_SIZE);

        for (const importDoc of chunk) {
          batch.delete(importDoc.ref);
          deletedImports++;
        }

        await batch.commit();
      }
    }

    // 3. Delete all transactions for this source
    const transactionsQuery = await ctx.db
      .collection("transactions")
      .where("userId", "==", ctx.userId)
      .where("sourceId", "==", sourceId)
      .get();

    if (!transactionsQuery.empty) {
      for (let i = 0; i < transactionsQuery.docs.length; i += BATCH_SIZE) {
        const chunk = transactionsQuery.docs.slice(i, i + BATCH_SIZE);

        // First, delete file connections for each transaction
        for (const txDoc of chunk) {
          const connectionsQuery = await ctx.db
            .collection("fileConnections")
            .where("transactionId", "==", txDoc.id)
            .get();

          if (!connectionsQuery.empty) {
            const connBatch = ctx.db.batch();
            for (const connDoc of connectionsQuery.docs) {
              connBatch.delete(connDoc.ref);

              // Update file to remove transaction from transactionIds
              const fileRef = ctx.db.collection("files").doc(connDoc.data().fileId);
              connBatch.update(fileRef, {
                transactionIds: FieldValue.arrayRemove(txDoc.id),
                updatedAt: now,
              });
            }
            await connBatch.commit();
          }
        }

        // Then delete the transactions
        const txBatch = ctx.db.batch();
        for (const txDoc of chunk) {
          txBatch.delete(txDoc.ref);
          deletedTransactions++;
        }
        await txBatch.commit();
      }
    }

    // 4. Clean up API provider connections if this was an API source
    if (sourceData.type === "api" && sourceData.apiConfig) {
      const apiConfig = sourceData.apiConfig as {
        provider?: string;
        connectionId?: string;
        bankConnectionId?: number;
        userAccessToken?: string;
      };

      if (apiConfig.provider === "truelayer" && apiConfig.connectionId) {
        try {
          const connectionRef = ctx.db.collection("truelayerConnections").doc(apiConfig.connectionId);
          await connectionRef.delete();
        } catch (err) {
          console.warn(`[deleteSource] Failed to delete TrueLayer connection:`, err);
        }
      }

      // Delete finAPI bank connection
      if (apiConfig.provider === "finapi" && apiConfig.bankConnectionId) {
        try {
          const clientId = process.env.FINAPI_CLIENT_ID;
          const clientSecret = process.env.FINAPI_CLIENT_SECRET;
          const environment = process.env.FINAPI_ENVIRONMENT || "sandbox";
          const baseUrl = environment === "production"
            ? "https://live.finapi.io"
            : "https://sandbox.finapi.io";

          if (clientId && clientSecret) {
            let accessToken = apiConfig.userAccessToken as string | undefined;
            const refreshToken = (sourceData.apiConfig as { userRefreshToken?: string }).userRefreshToken;

            // Try to refresh the token first if we have a refresh token
            if (refreshToken) {
              try {
                const tokenResponse = await fetch(`${baseUrl}/api/v2/oauth/token`, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: refreshToken,
                  }).toString(),
                });

                if (tokenResponse.ok) {
                  const tokenData = await tokenResponse.json() as { access_token: string };
                  accessToken = tokenData.access_token;
                  console.log(`[deleteSource] Refreshed finAPI token for bank connection delete`);
                }
              } catch (refreshErr) {
                console.warn(`[deleteSource] Failed to refresh finAPI token:`, refreshErr);
              }
            }

            if (accessToken) {
              const response = await fetch(
                `${baseUrl}/api/v2/bankConnections/${apiConfig.bankConnectionId}`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );
              if (response.ok) {
                console.log(`[deleteSource] Deleted finAPI bank connection: ${apiConfig.bankConnectionId}`);
              } else {
                const errorText = await response.text();
                console.warn(`[deleteSource] finAPI delete returned ${response.status}: ${errorText}`);
              }
            } else {
              console.warn(`[deleteSource] No access token available to delete finAPI connection`);
            }
          }
        } catch (err) {
          console.warn(`[deleteSource] Failed to delete finAPI connection:`, err);
        }
      }
    }

    // 5. Delete investment trades for depot sources
    if (sourceData.accountKind === "depot") {
      const tradesQuery = await ctx.db
        .collection("investmentTrades")
        .where("userId", "==", ctx.userId)
        .where("sourceId", "==", sourceId)
        .get();

      if (!tradesQuery.empty) {
        for (let i = 0; i < tradesQuery.docs.length; i += BATCH_SIZE) {
          const tradeBatch = ctx.db.batch();
          const chunk = tradesQuery.docs.slice(i, i + BATCH_SIZE);
          for (const tradeDoc of chunk) {
            tradeBatch.delete(tradeDoc.ref);
            deletedTrades++;
          }
          await tradeBatch.commit();
        }
      }

      // Also delete capital gains summaries for this user (they'll need recalculation)
      // We don't delete them here since they span all sources, just log a note
      if (deletedTrades > 0) {
        console.log(`[deleteSource] Deleted ${deletedTrades} investment trades for depot ${sourceId}`);
      }
    }

    // 6. Delete source partner if exists
    if (sourceData.sourcePartnerId) {
      try {
        const partnerRef = ctx.db.collection("partners").doc(sourceData.sourcePartnerId);
        const partnerSnap = await partnerRef.get();
        if (partnerSnap.exists && partnerSnap.data()?.userId === ctx.userId) {
          await partnerRef.delete();
          console.log(`[deleteSource] Deleted source partner ${sourceData.sourcePartnerId}`);
        }
      } catch (err) {
        console.warn(`[deleteSource] Failed to delete source partner:`, err);
      }
    }

    // 7. Delete the source document itself
    await sourceRef.delete();

    console.log(`[deleteSource] Deleted source ${sourceId}`, {
      userId: ctx.userId,
      deletedImports,
      deletedTransactions,
    });

    return {
      success: true,
      deletedImports,
      deletedTransactions,
      deletedTrades,
    };
  }
);
