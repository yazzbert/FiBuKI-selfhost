"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CapitalGainsSummary } from "@/types/capital-gains-summary";
import { useCapitalGains } from "@/hooks/use-capital-gains";
import { formatCurrency } from "@/lib/utils";
import { Calculator, Loader2 } from "lucide-react";

const COUNTRY_LABELS: Record<string, string> = {
  AT: "Austria",
  DE: "Germany",
  CH: "Switzerland",
};

export function CapitalGainsCard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { summary, loading, calculating, calculate } = useCapitalGains(year);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select
          value={year.toString()}
          onValueChange={(v) => setYear(parseInt(v))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y.toString()}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={calculate}
          disabled={calculating}
        >
          {calculating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Calculator className="h-4 w-4 mr-2" />
          )}
          {calculating ? "Calculating..." : "Recalculate"}
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : !summary ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No tax summary for {year} yet. Click &quot;Recalculate&quot; to generate.
          </CardContent>
        </Card>
      ) : (
        <SummaryDisplay summary={summary} />
      )}
    </div>
  );
}

function SummaryDisplay({ summary }: { summary: CapitalGainsSummary }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overview {summary.year}
            </CardTitle>
            <Badge variant="outline">
              {COUNTRY_LABELS[summary.country] || summary.country}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Realized Gains</div>
              <div className="text-lg font-mono font-semibold text-green-600">
                {formatCurrency(summary.totalRealizedGainEur, "EUR")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Realized Losses</div>
              <div className="text-lg font-mono font-semibold text-red-600">
                -{formatCurrency(summary.totalRealizedLossEur, "EUR")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net Result</div>
              <div className={`text-lg font-mono font-semibold ${summary.totalNetGainEur >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(summary.totalNetGainEur, "EUR")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Dividends</div>
              <div className="text-lg font-mono font-semibold">
                {formatCurrency(summary.totalDividendsEur, "EUR")}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground pt-2 border-t">
            {summary.tradeCount} trades
          </div>
        </CardContent>
      </Card>

      {/* Country-specific tax card */}
      {summary.country === "AT" && summary.kestLiabilityEur != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              KESt (27.5%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-mono font-bold">
              {formatCurrency(summary.kestLiabilityEur, "EUR")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Estimated capital gains tax liability
            </p>
          </CardContent>
        </Card>
      )}

      {summary.country === "DE" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Abgeltungssteuer Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Stock Gains:</span>{" "}
                <span className="font-mono">{formatCurrency(summary.deStockGainsEur ?? 0, "EUR")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Stock Losses:</span>{" "}
                <span className="font-mono text-red-600">-{formatCurrency(summary.deStockLossesEur ?? 0, "EUR")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Crypto Gains:</span>{" "}
                <span className="font-mono">{formatCurrency(summary.deCryptoGainsEur ?? 0, "EUR")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Crypto Losses:</span>{" "}
                <span className="font-mono text-red-600">-{formatCurrency(summary.deCryptoLossesEur ?? 0, "EUR")}</span>
              </div>
            </div>
            {(summary.deCryptoExemptGainsEur ?? 0) > 0 && (
              <div className="text-xs text-green-600 pt-1">
                {formatCurrency(summary.deCryptoExemptGainsEur!, "EUR")} crypto gains tax-free (held &gt;1 year)
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {summary.country === "CH" && summary.chYearEndHoldings && summary.chYearEndHoldings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Year-End Holdings (Wealth Tax)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.chYearEndHoldings.map((h) => (
                <div key={h.ticker} className="flex justify-between text-sm">
                  <span>
                    {h.ticker} <span className="text-muted-foreground">({h.quantity.toLocaleString("de-CH", { maximumFractionDigits: 4 })})</span>
                  </span>
                  <span className="font-mono">{formatCurrency(h.marketValueEur, "EUR")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-asset-type breakdown */}
      {summary.byAssetType.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              By Asset Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.byAssetType.map((a) => (
                <div key={a.assetType} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">
                      {a.assetType}
                    </Badge>
                    <span className="text-muted-foreground">{a.tradeCount} trades</span>
                  </div>
                  <span className={`font-mono ${a.netGainEur >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrency(a.netGainEur, "EUR")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
