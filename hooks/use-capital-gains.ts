"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { CapitalGainsSummary } from "@/types/capital-gains-summary";
import { callFunction } from "@/lib/firebase/callable";
import { useAuth } from "@/components/auth";

export function useCapitalGains(year: number) {
  const { userId } = useAuth();
  const [summary, setSummary] = useState<CapitalGainsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Realtime listener for the summary document
  useEffect(() => {
    if (!userId || !year) {
      setSummary(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const docId = `${userId}_${year}`;

    const unsubscribe = onSnapshot(
      doc(db, "capitalGainsSummaries", docId),
      (snap) => {
        startTransition(() => {
          if (snap.exists()) {
            setSummary({ id: snap.id, ...snap.data() } as CapitalGainsSummary);
          } else {
            setSummary(null);
          }
          setLoading(false);
        });
      },
      (err) => {
        console.error("Error fetching capital gains summary:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId, year]);

  const calculate = useCallback(async () => {
    setCalculating(true);
    try {
      await callFunction("calculateCapitalGainsSummary", { year });
    } catch (err) {
      console.error("Error calculating capital gains:", err);
      setError(err instanceof Error ? err : new Error("Calculation failed"));
    } finally {
      setCalculating(false);
    }
  }, [year]);

  return { summary, loading, calculating, error, calculate };
}
