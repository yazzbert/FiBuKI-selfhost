"use client";

import { PortfolioHolding } from "@/hooks/use-portfolio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface HoldingsViewProps {
  holdings: PortfolioHolding[];
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  stock: "Stock",
  etf: "ETF",
  crypto: "Crypto",
  bond: "Bond",
  other: "Other",
};

export function HoldingsView({ holdings }: HoldingsViewProps) {
  if (holdings.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No open positions. Import trades to see your holdings.
      </div>
    );
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.totalCost, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Portfolio (Cost Basis)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">
            {formatCurrency(totalValue, "EUR")}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {holdings.length} position{holdings.length !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {holdings.map((holding) => (
          <Card key={holding.ticker}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{holding.ticker}</span>
                    <Badge variant="outline" className="text-xs">
                      {ASSET_TYPE_LABELS[holding.assetType] || holding.assetType}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {holding.assetName}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-medium">
                    {formatCurrency(holding.totalCost, holding.currency)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {holding.quantity.toLocaleString("de-AT", { maximumFractionDigits: 4 })} units
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    avg {formatCurrency(holding.avgCostPerUnit, holding.currency)}/unit
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
