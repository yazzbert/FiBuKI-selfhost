"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { TrendingUp, Building2, Headset, Zap } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import {
  callFunction,
  updateOverageSettingsCallable,
} from "@/lib/firebase/callable";

export function BillingAddonsSection() {
  const { subscription, aiOverageCap, planConfig } = useSubscription();
  const [investmentsLoading, setInvestmentsLoading] = useState(false);
  const [bmdLoading, setBmdLoading] = useState(false);
  const [priorityLoading, setPriorityLoading] = useState(false);
  const [overageLoading, setOverageLoading] = useState(false);
  const [overageCap, setOverageCap] = useState(
    aiOverageCap > 0 ? aiOverageCap.toString() : "10"
  );

  const hasActiveSubscription = !!subscription?.stripeSubscriptionId &&
    subscription?.stripeSubscriptionStatus !== "canceled";
  const investmentsActive =
    subscription?.addons?.investments?.active ?? false;
  const bmdExportActive =
    subscription?.addons?.bmdExport?.active ?? false;
  const prioritySupportActive =
    subscription?.addons?.prioritySupport?.active ?? false;
  const overageEnabled = aiOverageCap > 0;

  const handleToggleInvestments = async (checked: boolean) => {
    setInvestmentsLoading(true);
    try {
      await callFunction(
        checked ? "activateInvestmentsAddon" : "deactivateInvestmentsAddon",
        {}
      );
    } catch (err) {
      console.error("Failed to toggle investments addon:", err);
    } finally {
      setInvestmentsLoading(false);
    }
  };

  const handleToggleBmdExport = async (checked: boolean) => {
    setBmdLoading(true);
    try {
      await callFunction(
        checked ? "activateBmdExportAddon" : "deactivateBmdExportAddon",
        {}
      );
    } catch (err) {
      console.error("Failed to toggle BMD export addon:", err);
    } finally {
      setBmdLoading(false);
    }
  };

  const handleTogglePrioritySupport = async (checked: boolean) => {
    setPriorityLoading(true);
    try {
      await callFunction(
        checked ? "activatePrioritySupportAddon" : "deactivatePrioritySupportAddon",
        {}
      );
    } catch (err) {
      console.error("Failed to toggle priority support addon:", err);
    } finally {
      setPriorityLoading(false);
    }
  };

  const handleOverageToggle = async (checked: boolean) => {
    setOverageLoading(true);
    try {
      const capEur = checked ? parseFloat(overageCap) || 10 : 0;
      await updateOverageSettingsCallable({ overageCapEur: capEur });
    } catch (err) {
      console.error("Failed to update overage settings:", err);
    } finally {
      setOverageLoading(false);
    }
  };

  const handleOverageCapBlur = async () => {
    if (!overageEnabled) return;
    const capEur = parseFloat(overageCap);
    if (isNaN(capEur) || capEur < 1 || capEur > 200) return;
    setOverageLoading(true);
    try {
      await updateOverageSettingsCallable({ overageCapEur: capEur });
    } catch (err) {
      console.error("Failed to update overage cap:", err);
    } finally {
      setOverageLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Addons</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {!hasActiveSubscription && (
          <p className="text-xs text-muted-foreground pb-3">
            Subscribe to a paid plan to enable addons.
          </p>
        )}

        {/* Overage spending */}
        {planConfig.overageAllowed && (
          <div className="py-3 first:pt-0 last:pb-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Overage spending</p>
                  <p className="text-xs text-muted-foreground">
                    AI continues beyond fair-use budget
                  </p>
                </div>
              </div>
              <Switch
                checked={overageEnabled}
                onCheckedChange={handleOverageToggle}
                disabled={overageLoading}
              />
            </div>
            {overageEnabled && (
              <div className="flex items-center gap-2 ml-7">
                <span className="text-xs text-muted-foreground">
                  Monthly cap:
                </span>
                <Input
                  type="number"
                  min="1"
                  max="200"
                  step="1"
                  value={overageCap}
                  onChange={(e) => setOverageCap(e.target.value)}
                  onBlur={handleOverageCapBlur}
                  className="w-20 h-7 text-xs"
                />
                <span className="text-xs text-muted-foreground">EUR</span>
              </div>
            )}
          </div>
        )}

        {/* BMD/NTCS Export */}
        <div className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-medium">BMD/NTCS Export</p>
                <p className="text-xs text-muted-foreground">
                  +5 EUR/mo
                </p>
              </div>
            </div>
            <Switch
              checked={bmdExportActive}
              onCheckedChange={handleToggleBmdExport}
              disabled={bmdLoading || !hasActiveSubscription}
            />
          </div>
        </div>

        {/* Investments */}
        <div className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Investments</p>
                <p className="text-xs text-muted-foreground">
                  +5 EUR/mo
                </p>
              </div>
            </div>
            <Switch
              checked={investmentsActive}
              onCheckedChange={handleToggleInvestments}
              disabled={investmentsLoading || !hasActiveSubscription}
            />
          </div>
        </div>

        {/* Priority Support */}
        <div className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Headset className="h-4 w-4 text-purple-600 shrink-0" />
              <div>
                <p className="text-sm font-medium">Priority Support</p>
                <p className="text-xs text-muted-foreground">
                  +50 EUR/mo
                </p>
              </div>
            </div>
            <Switch
              checked={prioritySupportActive}
              onCheckedChange={handleTogglePrioritySupport}
              disabled={priorityLoading || !hasActiveSubscription}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
