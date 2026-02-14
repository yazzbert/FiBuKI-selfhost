/**
 * Update a browser recipe after a replay attempt.
 * Updates: lastReplayResult, agentActions, useCount, lastUsedAt/lastFailedAt, invoiceTableMeta.
 */

import { createCallable, HttpsError } from "../utils/createCallable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

interface ReplayResultInput {
  status: "success" | "failed_element" | "failed_match" | "failed_auth" | "failed_timeout";
  tier: 1 | 2;
  failedAtStep?: number;
  durationMs: number;
  transactionId: string;
  fileId?: string;
  agentIterations?: number;
}

interface RecordedAction {
  step: number;
  actionType: string;
  url: string;
  targetUrl?: string;
  clickTarget?: {
    text: string;
    tagName: string;
    ariaLabel?: string;
    href?: string;
    selector?: string;
    contextText?: string;
  };
  inputValue?: string;
  pageContext?: {
    title: string;
    surroundingText: string;
  };
  relativeTimeMs: number;
  source?: "user" | "agent";
}

interface InvoiceTableMetaInput {
  containerSelector: string;
  rowSelector: string;
  columns: {
    index: number;
    selector?: string;
    semantic: "amount" | "date" | "description" | "downloadAction" | "status" | "unknown";
    exampleValues?: string[];
  }[];
  url: string;
}

interface UpdateBrowserRecipeRequest {
  partnerId: string;
  recipeId: string;
  lastReplayResult?: ReplayResultInput;
  agentActions?: RecordedAction[];
  invoiceTableMeta?: InvoiceTableMetaInput;
  incrementUseCount?: boolean;
  autoRun?: boolean;
  label?: string;
  /** Update recipe status */
  status?: "active" | "paused" | "error" | "needs_login";
  /** Update inferred frequency */
  inferredFrequencyDays?: number;
  /** Update frequency source */
  frequencySource?: "inferred" | "manual";
  /** Update frequency data points */
  frequencyDataPoints?: number;
  /** Update next expected fetch date */
  nextExpectedAt?: string; // ISO string, converted to Timestamp
  /** Update last error */
  lastError?: string | null;
  /** Increment successful/failed fetch counters */
  incrementSuccessfulFetches?: boolean;
  incrementFailedFetches?: boolean;
}

interface UpdateBrowserRecipeResponse {
  success: boolean;
}

export const updateBrowserRecipeCallable = createCallable<
  UpdateBrowserRecipeRequest,
  UpdateBrowserRecipeResponse
>(
  { name: "updateBrowserRecipe" },
  async (ctx, request) => {
    const { partnerId, recipeId, lastReplayResult, agentActions, invoiceTableMeta, incrementUseCount, autoRun, label } = request;

    if (!partnerId) {
      throw new HttpsError("invalid-argument", "partnerId is required");
    }
    if (!recipeId) {
      throw new HttpsError("invalid-argument", "recipeId is required");
    }

    // Verify partner belongs to user
    const partnerRef = ctx.db.collection("partners").doc(partnerId);
    const partnerDoc = await partnerRef.get();

    if (!partnerDoc.exists) {
      throw new HttpsError("not-found", "Partner not found");
    }
    if (partnerDoc.data()?.userId !== ctx.userId) {
      throw new HttpsError("permission-denied", "Partner belongs to a different user");
    }

    const existingRecipes: Array<Record<string, unknown>> = partnerDoc.data()?.browserRecipes || [];
    const recipeIndex = existingRecipes.findIndex((r) => r.id === recipeId);

    if (recipeIndex < 0) {
      throw new HttpsError("not-found", "Recipe not found");
    }

    const recipe = existingRecipes[recipeIndex];
    const now = Timestamp.now();

    // Update lastReplayResult
    if (lastReplayResult) {
      recipe.lastReplayResult = {
        ...lastReplayResult,
        timestamp: now,
      };

      // Update lastUsedAt / lastFailedAt
      if (lastReplayResult.status === "success") {
        recipe.lastUsedAt = now;
      } else {
        recipe.lastFailedAt = now;
      }
    }

    // Update agentActions (append new agent-learned actions)
    if (agentActions && agentActions.length > 0) {
      const cleanActions = agentActions.slice(0, 50).map((a) =>
        JSON.parse(JSON.stringify(a))
      );
      // Mark all as agent-sourced
      for (const action of cleanActions) {
        action.source = "agent";
      }
      recipe.agentActions = cleanActions;
    }

    // Update invoiceTableMeta
    if (invoiceTableMeta) {
      recipe.invoiceTableMeta = JSON.parse(JSON.stringify(invoiceTableMeta));
    }

    // Increment use count
    if (incrementUseCount) {
      recipe.useCount = ((recipe.useCount as number) || 0) + 1;
    }

    // Update autoRun flag
    if (typeof autoRun === "boolean") {
      recipe.autoRun = autoRun;
    }

    // Update label
    if (typeof label === "string") {
      recipe.label = label || null;
    }

    // Update status
    if (request.status) {
      recipe.status = request.status;
    }

    // Update frequency fields
    if (typeof request.inferredFrequencyDays === "number") {
      recipe.inferredFrequencyDays = request.inferredFrequencyDays;
    }
    if (request.frequencySource) {
      recipe.frequencySource = request.frequencySource;
    }
    if (typeof request.frequencyDataPoints === "number") {
      recipe.frequencyDataPoints = request.frequencyDataPoints;
    }
    if (request.nextExpectedAt) {
      recipe.nextExpectedAt = Timestamp.fromDate(new Date(request.nextExpectedAt));
    }

    // Update error
    if (request.lastError === null) {
      delete recipe.lastError;
    } else if (typeof request.lastError === "string") {
      recipe.lastError = request.lastError;
    }

    // Increment fetch counters
    if (request.incrementSuccessfulFetches) {
      recipe.successfulFetches = ((recipe.successfulFetches as number) || 0) + 1;
    }
    if (request.incrementFailedFetches) {
      recipe.failedFetches = ((recipe.failedFetches as number) || 0) + 1;
    }

    recipe.updatedAt = now;

    // Write back
    existingRecipes[recipeIndex] = recipe;
    await partnerRef.update({
      browserRecipes: existingRecipes,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);
