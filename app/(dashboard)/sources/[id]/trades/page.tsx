"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useSources } from "@/hooks/use-sources";
import { useInvestmentTrades } from "@/hooks/use-investment-trades";
import { usePortfolio } from "@/hooks/use-portfolio";
import { TradeTable } from "@/components/investments/trade-table";
import { HoldingsView } from "@/components/investments/holdings-view";
import { CapitalGainsCard } from "@/components/investments/capital-gains-card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Upload,
  Loader2,
  TrendingUp,
  BarChart3,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TradesPageProps {
  params: Promise<{ id: string }>;
}

type Tab = "trades" | "holdings" | "tax";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "trades", label: "Trades", icon: <TrendingUp className="h-4 w-4" /> },
  { key: "holdings", label: "Holdings", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "tax", label: "Tax Summary", icon: <Calculator className="h-4 w-4" /> },
];

export default function TradesPage({ params }: TradesPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { sources, loading: sourcesLoading } = useSources();
  const source = sources.find((s) => s.id === id) || null;
  const { trades, loading: tradesLoading } = useInvestmentTrades(id);
  const { holdings } = usePortfolio(trades);
  const [activeTab, setActiveTab] = useState<Tab>("trades");

  if (sourcesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!source || source.accountKind !== "depot") {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Source not found or not a depot account.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/sources")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Accounts
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{source.name}</h1>
            <p className="text-sm text-muted-foreground">
              {trades.length} trade{trades.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push(`/sources/${id}/import-trades`)}
        >
          <Upload className="h-4 w-4 mr-2" />
          Import Trades
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {tradesLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {activeTab === "trades" && <TradeTable trades={trades} />}
            {activeTab === "holdings" && <HoldingsView holdings={holdings} />}
            {activeTab === "tax" && <CapitalGainsCard />}
          </>
        )}
      </div>
    </div>
  );
}
