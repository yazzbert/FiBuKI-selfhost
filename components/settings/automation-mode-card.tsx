"use client";

import { useState } from "react";
import { Bot, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/use-subscription";
import { callFunction } from "@/lib/firebase/callable";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function AutomationModeButton() {
  const { automationMode, loading } = useSubscription();
  const [updating, setUpdating] = useState(false);

  const handleModeChange = async (mode: "active" | "passive") => {
    if (mode === automationMode || updating) return;
    setUpdating(true);
    try {
      await callFunction("updateAutomationMode", { mode });
    } catch (err) {
      console.error("[AutomationModeButton] Failed to update mode:", err);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {automationMode === "passive" ? (
            <Hand className="h-4 w-4 mr-1" />
          ) : (
            <Bot className="h-4 w-4 mr-1" />
          )}
          {automationMode === "passive" ? "Passive" : "Active"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-2">
          <p className="text-sm font-medium">Automation Mode</p>
          <p className="text-xs text-muted-foreground">
            Control how FiBuKI processes your documents.
          </p>
          <div className="grid gap-2 pt-1">
            <button
              type="button"
              disabled={updating}
              onClick={() => handleModeChange("active")}
              className={cn(
                "flex items-center gap-3 rounded-md border-2 p-3 text-left transition-colors",
                automationMode === "active"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30",
                updating && "opacity-50 cursor-not-allowed"
              )}
            >
              <Bot className={cn(
                "h-5 w-5 shrink-0",
                automationMode === "active" ? "text-primary" : "text-muted-foreground"
              )} />
              <div>
                <div className={cn(
                  "text-sm font-medium",
                  automationMode === "active" && "text-primary"
                )}>
                  Active
                </div>
                <p className="text-xs text-muted-foreground">
                  Auto-matches and searches for receipts.
                </p>
              </div>
            </button>

            <button
              type="button"
              disabled={updating}
              onClick={() => handleModeChange("passive")}
              className={cn(
                "flex items-center gap-3 rounded-md border-2 p-3 text-left transition-colors",
                automationMode === "passive"
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30",
                updating && "opacity-50 cursor-not-allowed"
              )}
            >
              <Hand className={cn(
                "h-5 w-5 shrink-0",
                automationMode === "passive" ? "text-primary" : "text-muted-foreground"
              )} />
              <div>
                <div className={cn(
                  "text-sm font-medium",
                  automationMode === "passive" && "text-primary"
                )}>
                  Passive
                </div>
                <p className="text-xs text-muted-foreground">
                  Suggests only. You connect manually.
                </p>
              </div>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
