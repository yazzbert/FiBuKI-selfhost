"use client";

import { useCallback } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InvoiceLineItem, computeLineItemTotals, DEFAULT_VAT_RATE } from "@/types/invoice";
import { cn } from "@/lib/utils";

interface InvoiceLineItemsTableProps {
  lineItems: InvoiceLineItem[];
  onChange: (lineItems: InvoiceLineItem[]) => void;
  disabled?: boolean;
}

function formatEur(cents: number): string {
  const safe = Math.round(cents);
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const euros = Math.floor(abs / 100);
  const remainder = abs % 100;
  const eurosStr = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${eurosStr},${String(remainder).padStart(2, "0")} €`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `li_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function InvoiceLineItemsTable({
  lineItems,
  onChange,
  disabled = false,
}: InvoiceLineItemsTableProps) {
  const updateItem = useCallback(
    (index: number, patch: Partial<InvoiceLineItem>) => {
      const next = lineItems.map((item, i) =>
        i === index ? { ...item, ...patch } : item
      );
      onChange(next);
    },
    [lineItems, onChange]
  );

  const removeItem = useCallback(
    (index: number) => {
      const next = lineItems.filter((_, i) => i !== index);
      onChange(next);
    },
    [lineItems, onChange]
  );

  const addItem = useCallback(() => {
    const next: InvoiceLineItem[] = [
      ...lineItems,
      {
        id: generateId(),
        description: "",
        quantity: 1,
        unitPrice: 0,
        vatRate: DEFAULT_VAT_RATE,
      },
    ];
    onChange(next);
  }, [lineItems, onChange]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[20px_minmax(0,1fr)_70px_110px_70px_110px_28px] gap-2 text-xs font-medium text-muted-foreground px-1">
        <span />
        <span>Beschreibung</span>
        <span className="text-right">Menge</span>
        <span className="text-right">Einzelpreis (€)</span>
        <span className="text-right">USt. %</span>
        <span className="text-right">Gesamt</span>
        <span />
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {lineItems.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
            Keine Positionen
          </div>
        ) : (
          lineItems.map((item, index) => {
            const { netCents } = computeLineItemTotals(item);
            // Display unit price as euros (with cents) - store as cents internally
            const unitEur =
              item.unitPrice === 0 ? "" : (item.unitPrice / 100).toString();
            return (
              <div
                key={item.id}
                className={cn(
                  "grid grid-cols-[20px_minmax(0,1fr)_70px_110px_70px_110px_28px] gap-2 items-center"
                )}
              >
                <div
                  className="text-muted-foreground flex items-center justify-center cursor-grab"
                  aria-hidden
                >
                  <GripVertical className="h-4 w-4" />
                </div>
                <Input
                  value={item.description}
                  onChange={(e) =>
                    updateItem(index, { description: e.target.value })
                  }
                  placeholder="Beschreibung"
                  disabled={disabled}
                  className="h-8"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  value={item.quantity}
                  min={0}
                  step={1}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    updateItem(index, {
                      quantity: Number.isFinite(v) ? v : 0,
                    });
                  }}
                  disabled={disabled}
                  className="h-8 text-right"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  value={unitEur}
                  step="0.01"
                  min={0}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      updateItem(index, { unitPrice: 0 });
                      return;
                    }
                    const eur = parseFloat(raw);
                    if (!Number.isFinite(eur)) return;
                    updateItem(index, {
                      unitPrice: Math.round(eur * 100),
                    });
                  }}
                  disabled={disabled}
                  className="h-8 text-right"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  value={item.vatRate}
                  step={1}
                  min={0}
                  max={100}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    updateItem(index, {
                      vatRate: Number.isFinite(v) ? v : 0,
                    });
                  }}
                  disabled={disabled}
                  className="h-8 text-right"
                />
                <div className="text-right text-sm tabular-nums px-1">
                  {formatEur(netCents)}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-7"
                  onClick={() => removeItem(index)}
                  disabled={disabled}
                  title="Position entfernen"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            );
          })
        )}
      </div>

      {/* Add row */}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addItem}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Position hinzufügen
        </Button>
      </div>
    </div>
  );
}
