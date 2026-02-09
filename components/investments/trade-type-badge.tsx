"use client";

import { Badge } from "@/components/ui/badge";
import { TradeType } from "@/types/investment-trade";

const TRADE_TYPE_CONFIG: Record<TradeType, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  buy: { label: "Buy", variant: "default" },
  sell: { label: "Sell", variant: "destructive" },
  dividend: { label: "Dividend", variant: "secondary" },
  interest: { label: "Interest", variant: "secondary" },
  fee: { label: "Fee", variant: "outline" },
  transfer_in: { label: "Transfer In", variant: "default" },
  transfer_out: { label: "Transfer Out", variant: "destructive" },
};

interface TradeTypeBadgeProps {
  tradeType: TradeType;
}

export function TradeTypeBadge({ tradeType }: TradeTypeBadgeProps) {
  const config = TRADE_TYPE_CONFIG[tradeType] || { label: tradeType, variant: "outline" as const };
  return (
    <Badge variant={config.variant} className="text-xs">
      {config.label}
    </Badge>
  );
}
