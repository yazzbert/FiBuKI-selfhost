"use client";

import { useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useUserData } from "@/hooks/use-user-data";
import { IdentityEntity } from "@/types/user-data";
import { bicFromIban } from "@/lib/invoicing/bicLookup";

export interface SelectedIssuer {
  entityId: string;
  iban: string;
}

interface InvoiceIssuerPickerProps {
  value?: SelectedIssuer | null;
  onChange: (selection: SelectedIssuer) => void;
  disabled?: boolean;
}

function getEntities(
  personal: IdentityEntity | undefined,
  companies: IdentityEntity[] | undefined
): IdentityEntity[] {
  const list: IdentityEntity[] = [];
  if (personal) list.push(personal);
  if (companies) list.push(...companies);
  return list;
}

export function InvoiceIssuerPicker({
  value,
  onChange,
  disabled = false,
}: InvoiceIssuerPickerProps) {
  const { userData, loading } = useUserData();

  const entities = useMemo(
    () =>
      getEntities(userData?.personalEntity, userData?.companies).filter(
        (e) => e.name && e.ibans && e.ibans.length > 0
      ),
    [userData]
  );

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === value?.entityId) ?? null,
    [entities, value?.entityId]
  );

  // Auto-pick first entity + first IBAN when nothing selected yet
  useEffect(() => {
    if (loading) return;
    if (!value && entities.length > 0) {
      const first = entities[0];
      if (first.ibans[0]) {
        onChange({ entityId: first.id, iban: first.ibans[0] });
      }
    }
  }, [loading, value, entities, onChange]);

  const handleEntityChange = (entityId: string) => {
    const e = entities.find((x) => x.id === entityId);
    if (!e) return;
    onChange({ entityId: e.id, iban: e.ibans[0] ?? "" });
  };

  const handleIbanChange = (iban: string) => {
    if (!selectedEntity) return;
    onChange({ entityId: selectedEntity.id, iban });
  };

  const derivedBic = value?.iban ? bicFromIban(value.iban) : undefined;

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">Lade Identität…</div>
    );
  }

  if (entities.length === 0) {
    return (
      <div className="text-sm text-amber-700 bg-amber-50 border border-amber-300 rounded-md p-2">
        Keine Identität mit IBAN konfiguriert. Bitte unter
        Einstellungen &gt; Identität anlegen.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Absender</Label>
        <Select
          value={value?.entityId ?? ""}
          onValueChange={handleEntityChange}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Identität wählen" />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
                {e.type === "company" ? " (Firma)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedEntity && selectedEntity.ibans.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">IBAN</Label>
          <Select
            value={value?.iban ?? ""}
            onValueChange={handleIbanChange}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="IBAN wählen" />
            </SelectTrigger>
            <SelectContent>
              {selectedEntity.ibans.map((iban) => (
                <SelectItem key={iban} value={iban}>
                  {iban}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {selectedEntity && (
        <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
          {selectedEntity.vatId && <div>UID: {selectedEntity.vatId}</div>}
          {derivedBic && <div>BIC: {derivedBic}</div>}
        </div>
      )}
    </div>
  );
}
