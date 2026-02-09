"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { callFunction } from "@/lib/firebase/callable";
import { Subscription } from "@/types/billing";
import { TrendingUp, Loader2 } from "lucide-react";

interface InvestmentsAddonCardProps {
  subscription: Subscription | null;
}

export function InvestmentsAddonCard({ subscription }: InvestmentsAddonCardProps) {
  const [loading, setLoading] = useState(false);
  const isActive = subscription?.addons?.investments?.active ?? false;

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (isActive) {
        await callFunction("deactivateInvestmentsAddon", {});
      } else {
        await callFunction("activateInvestmentsAddon", {});
      }
    } catch (err) {
      console.error("Failed to toggle investments addon:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Investments Addon</CardTitle>
          </div>
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Track your investments, calculate FIFO cost basis, and generate annual capital gains summaries for AT/DE/CH tax reporting.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold">+5,00 EUR/month</span>
          <Button
            variant={isActive ? "outline" : "default"}
            size="sm"
            onClick={handleToggle}
            disabled={loading}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
