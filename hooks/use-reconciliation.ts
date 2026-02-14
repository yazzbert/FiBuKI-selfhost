"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/components/auth";
import { callFunction } from "@/lib/firebase/callable";
import type { CardReconciliationGroup } from "@/types/card-reconciliation";

interface UseReconciliationOptions {
  /** Filter by card source ID */
  cardSourceId?: string;
  /** Filter by bank source ID */
  bankSourceId?: string;
  /** Filter by status */
  status?: "suggested" | "confirmed" | "rejected";
}

export function useReconciliation(options: UseReconciliationOptions = {}) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<CardReconciliationGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const constraints = [
      where("userId", "==", user.uid),
    ];

    if (options.cardSourceId) {
      constraints.push(where("cardSourceId", "==", options.cardSourceId));
    }
    if (options.bankSourceId) {
      constraints.push(where("bankSourceId", "==", options.bankSourceId));
    }
    if (options.status) {
      constraints.push(where("status", "==", options.status));
    }

    const q = query(
      collection(db, "cardReconciliationGroups"),
      ...constraints
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const results: CardReconciliationGroup[] = [];
        snapshot.forEach((doc) => {
          results.push({ id: doc.id, ...doc.data() } as CardReconciliationGroup);
        });
        // Sort by confidence descending
        results.sort((a, b) => b.confidence - a.confidence);
        setGroups(results);
        setLoading(false);
      },
      (err) => {
        console.error("[useReconciliation] Error:", err);
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user?.uid, options.cardSourceId, options.bankSourceId, options.status]);

  const confirmGroup = useCallback(
    async (
      groupId: string,
      cardTransactionIds?: string[],
      note?: string
    ) => {
      return callFunction<
        { groupId: string; cardTransactionIds?: string[]; note?: string },
        { success: boolean; reconciledCount: number }
      >("confirmReconciliation", { groupId, cardTransactionIds, note });
    },
    []
  );

  const rejectGroup = useCallback(async (groupId: string) => {
    return callFunction<
      { groupId: string },
      { success: boolean }
    >("rejectReconciliation", { groupId });
  }, []);

  return {
    groups,
    loading,
    error,
    confirmGroup,
    rejectGroup,
  };
}
