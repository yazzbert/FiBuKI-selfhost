"use client";

import { useState, useMemo, useCallback } from "react";
import { format } from "date-fns";
import {
  CreditCard,
  Building2,
  Check,
  X,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, toDateSafe } from "@/lib/utils";
import type { Transaction } from "@/types/transaction";
import type { CardReconciliationGroup } from "@/types/card-reconciliation";

interface ReconciliationReviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: CardReconciliationGroup | null;
  bankTransaction: Transaction | null;
  cardTransactions: Transaction[];
  cardSourceName?: string;
  onConfirm: (
    groupId: string,
    selectedCardTxIds: string[],
    note?: string
  ) => Promise<void>;
  onReject: (groupId: string) => Promise<void>;
}

function formatAmount(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function ReconciliationReviewPanel({
  open,
  onOpenChange,
  group,
  bankTransaction,
  cardTransactions,
  cardSourceName,
  onConfirm,
  onReject,
}: ReconciliationReviewPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize selected IDs when group changes
  useMemo(() => {
    if (group) {
      setSelectedIds(new Set(group.cardTransactionIds));
    }
  }, [group?.id]);

  const selectedSum = useMemo(() => {
    let sum = 0;
    for (const tx of cardTransactions) {
      if (selectedIds.has(tx.id)) {
        sum += Math.abs(tx.amount);
      }
    }
    return sum;
  }, [selectedIds, cardTransactions]);

  const bankAmount = bankTransaction ? Math.abs(bankTransaction.amount) : 0;
  const remainder = bankAmount - selectedSum;

  const toggleTransaction = useCallback((txId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) {
        next.delete(txId);
      } else {
        next.add(txId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === cardTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(cardTransactions.map((tx) => tx.id)));
    }
  }, [selectedIds.size, cardTransactions]);

  const handleConfirm = async () => {
    if (!group) return;
    setIsSubmitting(true);
    try {
      await onConfirm(group.id, Array.from(selectedIds));
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!group) return;
    setIsSubmitting(true);
    try {
      await onReject(group.id);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!group || !bankTransaction) return null;

  const remainderPercent = bankAmount > 0
    ? Math.abs(remainder / bankAmount) * 100
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Card Reconciliation
          </SheetTitle>
          <SheetDescription>
            Match card charges to this bank payment
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 -mx-6">
          <ScrollArea className="h-full px-6">
            <div className="space-y-4 pb-4">
              {/* Bank payment summary */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Bank Payment
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {formatAmount(bankTransaction.amount, bankTransaction.currency)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {bankTransaction.partner || bankTransaction.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {toDateSafe(bankTransaction.date)
                    ? format(toDateSafe(bankTransaction.date)!, "MMM d, yyyy")
                    : "—"}
                </p>
              </div>

              <div className="flex items-center justify-center">
                <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
              </div>

              {/* Card charges list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    {cardSourceName || "Card Charges"}
                    <span className="text-xs text-muted-foreground">
                      ({selectedIds.size}/{cardTransactions.length})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={toggleAll}
                  >
                    {selectedIds.size === cardTransactions.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>

                <div className="space-y-1">
                  {cardTransactions.map((tx) => {
                    const isSelected = selectedIds.has(tx.id);
                    const txDate = toDateSafe(tx.date);

                    return (
                      <label
                        key={tx.id}
                        className={cn(
                          "flex items-center gap-3 rounded-md border p-2 cursor-pointer",
                          "transition-colors duration-150",
                          isSelected
                            ? "bg-primary/5 border-primary/20"
                            : "hover:bg-muted/50"
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleTransaction(tx.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">
                            {tx.partner || tx.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {txDate ? format(txDate, "MMM d") : "—"}
                            {tx.name !== tx.partner && tx.partner
                              ? ` · ${tx.name}`
                              : ""}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "text-sm tabular-nums whitespace-nowrap font-medium",
                            tx.amount < 0
                              ? "text-amount-negative"
                              : "text-amount-positive"
                          )}
                        >
                          {formatAmount(tx.amount, tx.currency)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Running total and remainder */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Selected charges total
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatAmount(-selectedSum)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bank payment</span>
                  <span className="tabular-nums font-medium">
                    {formatAmount(bankTransaction.amount, bankTransaction.currency)}
                  </span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Remainder</span>
                    <span
                      className={cn(
                        "tabular-nums font-semibold",
                        Math.abs(remainder) < 1
                          ? "text-green-600"
                          : remainderPercent > 5
                            ? "text-amber-600"
                            : "text-muted-foreground"
                      )}
                    >
                      {formatAmount(remainder)}
                    </span>
                  </div>
                  {remainderPercent > 2 && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {remainderPercent.toFixed(1)}% difference — may include
                      fees or FX adjustments
                    </p>
                  )}
                </div>
              </div>

              {/* Confidence score */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help underline decoration-dotted">
                      {group.confidence}% confidence
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1 text-xs">
                      <p>Amount match: {group.scoreBreakdown.amountSum}/40</p>
                      <p>Date window: {group.scoreBreakdown.dateWindow}/25</p>
                      <p>Source link: {group.scoreBreakdown.sourceLink}/20</p>
                      <p>Partner signal: {group.scoreBreakdown.partnerSignal}/15</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
                <span>·</span>
                <span className="capitalize">{group.pattern.replace("_", " ")}</span>
              </div>
            </div>
          </ScrollArea>
        </div>

        <SheetFooter className="flex-row gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isSubmitting}
            className="flex-1"
          >
            <X className="h-4 w-4" />
            Not a Match
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || selectedIds.size === 0}
            className="flex-1"
          >
            <Check className="h-4 w-4" />
            Confirm ({selectedIds.size})
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
