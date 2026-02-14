"use client";

import { useState, useCallback, useMemo } from "react";
import { callFunction } from "@/lib/firebase/callable";
import { db } from "@/lib/firebase/config";
import {
  doc,
  getDoc,
} from "firebase/firestore";
import { useAuth } from "@/components/auth";
import { UserPartner } from "@/types/partner";
import {
  inferInvoiceFrequency,
  getFrequencyLabel,
} from "@/lib/operations/invoice-source-ops";

export { getFrequencyLabel };

export function useBrowserRecipes(partnerId: string) {
  const { userId } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctx = useMemo(() => ({ db, userId: userId ?? "" }), [userId]);

  const deleteRecipe = useCallback(
    async (recipeId: string) => {
      await callFunction("deleteBrowserRecipe", { partnerId, recipeId });
    },
    [partnerId]
  );

  const toggleAutoRun = useCallback(
    async (recipeId: string, autoRun: boolean) => {
      await callFunction("updateBrowserRecipe", { partnerId, recipeId, autoRun });
    },
    [partnerId]
  );

  const updateLabel = useCallback(
    async (recipeId: string, label: string) => {
      await callFunction("updateBrowserRecipe", { partnerId, recipeId, label });
    },
    [partnerId]
  );

  /**
   * Toggle recipe status between active and paused
   */
  const toggleStatus = useCallback(
    async (recipeId: string, newStatus: "active" | "paused") => {
      setError(null);
      try {
        await callFunction("updateBrowserRecipe", {
          partnerId,
          recipeId,
          status: newStatus,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update status";
        setError(message);
        throw err;
      }
    },
    [partnerId]
  );

  /**
   * Add a bookmark recipe (empty recordedActions — just a URL)
   */
  const addBookmark = useCallback(
    async (url: string, label?: string, sourceType?: "manual" | "email_link" | "browser_detected"): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        let domain: string;
        try {
          domain = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          domain = url;
        }
        const result = await callFunction("saveBrowserRecipe", {
          partnerId,
          startUrl: url,
          domain,
          recordedActions: [],
          requiresAuth: false,
          label: label || undefined,
          status: "active",
          sourceType: sourceType || "manual",
        });
        return (result as { recipeId: string }).recipeId;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to add bookmark";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [partnerId]
  );

  /**
   * Promote a discovered invoice link to a bookmark recipe
   */
  const promoteLink = useCallback(
    async (linkIndex: number): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        // Read partner to get invoice links
        const partnerRef = doc(db, "partners", partnerId);
        const partnerSnap = await getDoc(partnerRef);
        if (!partnerSnap.exists()) throw new Error("Partner not found");

        const partner = partnerSnap.data() as UserPartner;
        if (partner.userId !== (userId ?? "")) throw new Error("Access denied");

        const invoiceLinks = partner.invoiceLinks || [];
        if (linkIndex < 0 || linkIndex >= invoiceLinks.length) {
          throw new Error("Invoice link not found");
        }

        const link = invoiceLinks[linkIndex];
        const recipeId = await addBookmark(
          link.url,
          link.anchorText || undefined,
          "email_link"
        );
        return recipeId;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to promote link";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [partnerId, userId, addBookmark]
  );

  /**
   * Infer frequency for a recipe from historical files
   */
  const inferFrequency = useCallback(
    async (recipeId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await inferInvoiceFrequency(ctx, partnerId, recipeId);
        if (!result) {
          setError("Not enough data to infer frequency (need at least 3 invoices)");
          return;
        }

        await callFunction("updateBrowserRecipe", {
          partnerId,
          recipeId,
          inferredFrequencyDays: result.frequencyDays,
          frequencySource: "inferred",
          frequencyDataPoints: result.dataPoints,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to infer frequency";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [ctx, partnerId]
  );

  return {
    deleteRecipe,
    toggleAutoRun,
    updateLabel,
    toggleStatus,
    addBookmark,
    promoteLink,
    inferFrequency,
    isLoading,
    error,
  };
}
