"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { BackCountryDialog } from "@/components/expand/back-country-dialog";
import { EXPANDABLE_COUNTRIES } from "@/types/expand";
import type { CountryExpansion } from "@/types/expand";

interface InlineCountryExpandProps {
  countryCode: string;
  onBack: () => void;
}

export function InlineCountryExpand({ countryCode, onBack }: InlineCountryExpandProps) {
  const searchParams = useSearchParams();
  const isSuccess = searchParams.get("success") === "1";
  const meta = EXPANDABLE_COUNTRIES.find((c) => c.code === countryCode);

  const [country, setCountry] = useState<CountryExpansion | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "countryExpansion", countryCode),
      (snap) => {
        if (snap.exists()) {
          setCountry({ ...snap.data(), countryCode: snap.id } as CountryExpansion);
        }
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [countryCode]);

  const progress = country
    ? Math.min((country.currentBackers / country.targetBackers) * 100, 100)
    : 0;
  const remaining = country
    ? Math.max(country.targetBackers - country.currentBackers, 0)
    : 0;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      {isSuccess && (
        <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 p-3 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
          <p className="text-sm text-green-900 dark:text-green-200">
            Thank you for backing {meta?.name}! We&apos;ll notify you when PSD2
            banking goes live.
          </p>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse h-36 rounded-lg bg-muted" />
      ) : country ? (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <span className="text-4xl">{meta?.flag}</span>
            <h3 className="text-lg font-semibold">
              Help unlock banking in {meta?.name}
            </h3>
            <p className="text-sm text-muted-foreground">
              Back with €10 to help activate PSD2 bank connections. It covers
              your entire first month.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <StatusBadge status={country.status} />
            </div>
            <Progress value={progress} className="h-3" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {country.currentBackers}
                </span>{" "}
                / {country.targetBackers} backers
              </span>
              {remaining > 0 && country.status === "funding" && (
                <span className="text-muted-foreground">
                  {remaining} more needed
                </span>
              )}
            </div>
          </div>

          {country.status === "funding" && (
            <Button className="w-full" onClick={() => setShowDialog(true)}>
              Back {meta?.name} — €10
            </Button>
          )}

          {country.status === "active" && (
            <p className="text-sm text-center text-green-700 dark:text-green-400 font-medium">
              Banking is live! Select this country to connect your bank.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          Country information not available yet.
        </p>
      )}

      <BackCountryDialog
        countryCode={showDialog ? countryCode : null}
        onClose={() => setShowDialog(false)}
        successUrl={`${origin}/sources/connect?success=1`}
        cancelUrl={`${origin}/sources/connect`}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: CountryExpansion["status"] }) {
  switch (status) {
    case "funding":
      return <Badge variant="info">Funding</Badge>;
    case "active":
      return <Badge variant="success">Live</Badge>;
    case "coming_soon":
      return <Badge variant="muted">Coming Soon</Badge>;
  }
}
