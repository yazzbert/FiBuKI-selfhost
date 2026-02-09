"use client";

import { useState, useEffect, startTransition } from "react";
import { collection, query, orderBy, onSnapshot, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { InvestmentTrade } from "@/types/investment-trade";
import { useAuth } from "@/components/auth";

export function useInvestmentTrades(sourceId: string | null) {
  const { userId } = useAuth();
  const [trades, setTrades] = useState<InvestmentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId || !sourceId) {
      setTrades([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "investmentTrades"),
      where("userId", "==", userId),
      where("sourceId", "==", sourceId),
      orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as InvestmentTrade[];

        startTransition(() => {
          setTrades(data);
          setLoading(false);
        });
      },
      (err) => {
        console.error("Error fetching investment trades:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId, sourceId]);

  return { trades, loading, error };
}
