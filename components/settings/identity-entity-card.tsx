"use client";

import { useState } from "react";
import { User, Building2, Trash2, X, Plus, Lock, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { IdentityEntityFormData } from "@/types/user-data";
import { cn } from "@/lib/utils";

interface InferredIban {
  iban: string;
  sourceName: string;
}

interface IdentityEntityCardProps {
  entity: IdentityEntityFormData;
  isPersonal?: boolean;
  onChange: (updates: Partial<IdentityEntityFormData>) => void;
  onDelete?: () => void;
  inferredIbans?: InferredIban[];
  className?: string;
}

export function IdentityEntityCard({
  entity,
  isPersonal = false,
  onChange,
  onDelete,
  inferredIbans = [],
  className,
}: IdentityEntityCardProps) {
  const [newAlias, setNewAlias] = useState("");
  const [newIban, setNewIban] = useState("");

  const Icon = isPersonal ? User : Building2;
  const title = isPersonal ? "Personal Identity" : "Company";
  const namePlaceholder = isPersonal ? "Your full name" : "Company name";

  const handleAddAlias = () => {
    const trimmed = newAlias.trim();
    if (trimmed && !entity.aliases.includes(trimmed)) {
      onChange({ aliases: [...entity.aliases, trimmed] });
      setNewAlias("");
    }
  };

  const handleRemoveAlias = (alias: string) => {
    onChange({ aliases: entity.aliases.filter((a) => a !== alias) });
  };

  const handleAddIban = () => {
    const normalized = newIban.trim().toUpperCase().replace(/\s/g, "");
    if (
      normalized &&
      !entity.ibans.includes(normalized) &&
      !inferredIbans.some((i) => i.iban === normalized)
    ) {
      onChange({ ibans: [...entity.ibans, normalized] });
      setNewIban("");
    }
  };

  const handleRemoveIban = (iban: string) => {
    onChange({ ibans: entity.ibans.filter((i) => i !== iban) });
  };

  const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handler();
    }
  };

  return (
    <Card className={cn("relative", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center",
              isPersonal ? "bg-primary/10" : "bg-blue-500/10"
            )}>
              <Icon className={cn(
                "h-5 w-5",
                isPersonal ? "text-primary" : "text-blue-500"
              )} />
            </div>
            <div>
              <h3 className="font-semibold">{title}</h3>
              {entity.partnerId && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <LinkIcon className="h-3 w-3" />
                  Linked to partner
                </span>
              )}
            </div>
          </div>
          {!isPersonal && onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Name + VAT ID (two-column) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${entity.id}-name`}>Name</Label>
            <Input
              id={`${entity.id}-name`}
              placeholder={namePlaceholder}
              value={entity.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${entity.id}-vatId`}>VAT ID</Label>
            <Input
              id={`${entity.id}-vatId`}
              placeholder="e.g., ATU12345678"
              value={entity.vatId || ""}
              onChange={(e) => onChange({ vatId: e.target.value })}
              className="font-mono"
            />
          </div>
        </div>

        {/* Aliases */}
        <div className="space-y-2">
          <Label>Aliases</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Add alias..."
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleAddAlias)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAddAlias}
              disabled={!newAlias.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {entity.aliases.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {entity.aliases.map((alias) => (
                <Badge key={alias} variant="secondary" className="gap-1 pr-1">
                  {alias}
                  <button
                    type="button"
                    onClick={() => handleRemoveAlias(alias)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* IBANs */}
        <div className="space-y-2">
          <Label>IBANs</Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g., AT12 3456 7890 1234 5678"
              value={newIban}
              onChange={(e) => setNewIban(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleAddIban)}
              className="flex-1 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleAddIban}
              disabled={!newIban.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {(inferredIbans.length > 0 || entity.ibans.length > 0) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {inferredIbans.map(({ iban, sourceName }) => (
                <Badge
                  key={iban}
                  variant="outline"
                  className="gap-1 font-mono text-muted-foreground"
                  title={`From: ${sourceName}`}
                >
                  <Lock className="h-3 w-3" />
                  {iban}
                </Badge>
              ))}
              {entity.ibans.map((iban) => (
                <Badge key={iban} variant="secondary" className="gap-1 pr-1 font-mono">
                  {iban}
                  <button
                    type="button"
                    onClick={() => handleRemoveIban(iban)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
