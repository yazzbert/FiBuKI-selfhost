"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Save, Loader2, Plus, X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserData } from "@/hooks/use-user-data";
import { useSources } from "@/hooks/use-sources";
import { IdentityEntityFormData, TaxCountryCode } from "@/types/user-data";
import { useAuth } from "@/components/auth";
import { IdentityEntityCard } from "@/components/settings/identity-entity-card";
import { generateEntityId } from "@/lib/operations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPageHeader } from "@/components/ui/settings-page-header";

const TAX_COUNTRIES: { value: TaxCountryCode; label: string; flag: string }[] = [
  { value: "AT", label: "Austria", flag: "🇦🇹" },
  { value: "DE", label: "Germany", flag: "🇩🇪" },
  { value: "CH", label: "Switzerland", flag: "🇨🇭" },
];

/**
 * Format Austrian tax number: 292090289 -> 29 209/0289
 */
function formatAustrianTaxNumber(value: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)}/${digits.slice(5, 9)}`;
}

/**
 * Create a default personal entity
 */
function createDefaultPersonalEntity(): IdentityEntityFormData {
  return {
    id: generateEntityId(),
    type: "person",
    name: "",
    aliases: [],
    vatId: "",
    ibans: [],
  };
}

/**
 * Create a default company entity
 */
function createDefaultCompany(): IdentityEntityFormData {
  return {
    id: generateEntityId(),
    type: "company",
    name: "",
    aliases: [],
    vatId: "",
    ibans: [],
  };
}

export default function IdentityPage() {
  const { user } = useAuth();
  const { userData, loading: userDataLoading, saving, save } = useUserData();
  const { sources } = useSources();

  // Global settings
  const [country, setCountry] = useState<TaxCountryCode>("AT");
  const [taxNumber, setTaxNumber] = useState("");
  const [ownEmails, setOwnEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  // Entity state
  const [personalEntity, setPersonalEntity] = useState<IdentityEntityFormData>(
    createDefaultPersonalEntity()
  );
  const [companies, setCompanies] = useState<IdentityEntityFormData[]>([]);

  const [saveSuccess, setSaveSuccess] = useState(false);

  // Inferred IBANs from bank accounts
  const inferredIbans = useMemo(() => {
    return sources
      .filter((s) => s.iban && s.accountKind === "bank_account")
      .map((s) => ({
        iban: s.iban!.toUpperCase().replace(/\s/g, ""),
        sourceName: s.name,
      }));
  }, [sources]);

  // Inferred emails from auth providers
  const inferredEmails = useMemo(() => {
    if (!user) return [];
    const emails = user.providerData
      .filter((p) => p.email)
      .map((p) => p.email!.toLowerCase());
    return [...new Set(emails)];
  }, [user]);

  // Load data from userData
  useEffect(() => {
    if (userData) {
      setCountry(userData.country || "AT");
      setTaxNumber(userData.taxNumber || "");
      setOwnEmails(userData.ownEmails || []);

      // Load personal entity (with migration from old format)
      if (userData.personalEntity) {
        setPersonalEntity({
          id: userData.personalEntity.id,
          type: "person",
          name: userData.personalEntity.name || "",
          aliases: userData.personalEntity.aliases || [],
          vatId: userData.personalEntity.vatId || "",
          ibans: userData.personalEntity.ibans || [],
          partnerId: userData.personalEntity.partnerId,
        });
      } else if (userData.name) {
        // Migrate from old format
        setPersonalEntity({
          id: generateEntityId(),
          type: "person",
          name: userData.name || "",
          aliases: userData.aliases || [],
          vatId: userData.vatIds?.[0] || "",
          ibans: userData.ibans || [],
          partnerId: userData.identityPartnerIds?.name,
        });
      }

      // Load companies
      if (userData.companies && userData.companies.length > 0) {
        setCompanies(
          userData.companies.map((c) => ({
            id: c.id,
            type: "company" as const,
            name: c.name || "",
            aliases: c.aliases || [],
            vatId: c.vatId || "",
            ibans: c.ibans || [],
            partnerId: c.partnerId,
          }))
        );
      } else if (userData.companyName) {
        // Migrate from old format
        setCompanies([
          {
            id: generateEntityId(),
            type: "company",
            name: userData.companyName,
            aliases: [],
            vatId: userData.vatIds?.[1] || "",
            ibans: [],
            partnerId: userData.identityPartnerIds?.companyName,
          },
        ]);
      }
    }
  }, [userData]);

  // Email management
  const handleAddEmail = () => {
    const normalized = newEmail.trim().toLowerCase();
    if (
      normalized &&
      !ownEmails.includes(normalized) &&
      !inferredEmails.includes(normalized)
    ) {
      setOwnEmails([...ownEmails, normalized]);
      setNewEmail("");
    }
  };

  const handleRemoveEmail = (email: string) => {
    setOwnEmails(ownEmails.filter((e) => e !== email));
  };

  const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handler();
    }
  };

  // Company management
  const handleAddCompany = () => {
    setCompanies([...companies, createDefaultCompany()]);
  };

  const handleUpdateCompany = (index: number, updates: Partial<IdentityEntityFormData>) => {
    const updated = [...companies];
    updated[index] = { ...updated[index], ...updates };
    setCompanies(updated);
  };

  const handleDeleteCompany = (index: number) => {
    setCompanies(companies.filter((_, i) => i !== index));
  };

  const handleUpdatePersonal = (updates: Partial<IdentityEntityFormData>) => {
    setPersonalEntity({ ...personalEntity, ...updates });
  };

  // Save handler
  const handleSave = async () => {
    setSaveSuccess(false);
    await save({
      country,
      taxNumber: taxNumber || undefined,
      ownEmails,
      personalEntity,
      companies,
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Change detection
  const hasChanges = useMemo(() => {
    if (!userData) return true;

    // Check global settings
    if (country !== (userData.country || "AT")) return true;
    if (taxNumber !== (userData.taxNumber || "")) return true;
    if (JSON.stringify(ownEmails) !== JSON.stringify(userData.ownEmails || [])) return true;

    // Check personal entity
    const originalPersonal = userData.personalEntity || {
      name: userData.name || "",
      aliases: userData.aliases || [],
      vatId: userData.vatIds?.[0] || "",
      ibans: userData.ibans || [],
    };
    if (personalEntity.name !== originalPersonal.name) return true;
    if (JSON.stringify(personalEntity.aliases) !== JSON.stringify(originalPersonal.aliases || [])) return true;
    if ((personalEntity.vatId || "") !== (originalPersonal.vatId || "")) return true;
    if (JSON.stringify(personalEntity.ibans) !== JSON.stringify(originalPersonal.ibans || [])) return true;

    // Check companies
    const originalCompanies = userData.companies || (userData.companyName ? [{
      name: userData.companyName,
      aliases: [],
      vatId: userData.vatIds?.[1] || "",
      ibans: [],
    }] : []);
    if (companies.length !== originalCompanies.length) return true;
    for (let i = 0; i < companies.length; i++) {
      const comp = companies[i];
      const orig = originalCompanies[i];
      if (comp.name !== (orig?.name || "")) return true;
      if (JSON.stringify(comp.aliases) !== JSON.stringify(orig?.aliases || [])) return true;
      if ((comp.vatId || "") !== (orig?.vatId || "")) return true;
      if (JSON.stringify(comp.ibans) !== JSON.stringify(orig?.ibans || [])) return true;
    }

    return false;
  }, [userData, country, taxNumber, ownEmails, personalEntity, companies]);

  return (
    <>
      <SettingsPageHeader
        title="Your Identity"
        description="Manage your personal and business identities for invoice matching"
      />

      {userDataLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-8" data-onboarding="identity-form">
          {/* Tax Country */}
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="country">Tax Residence Country</Label>
            <Select value={country} onValueChange={(v) => setCountry(v as TaxCountryCode)}>
              <SelectTrigger id="country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_COUNTRIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="flex items-center gap-2">
                      <span>{c.flag}</span>
                      <span>{c.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tax Number (FASTNR) - Austria only */}
          {country === "AT" && (
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="taxNumber">Steuernummer</Label>
              <p className="text-sm text-muted-foreground">
                Required for FinanzOnline XML export
              </p>
              <Input
                id="taxNumber"
                placeholder="e.g., 29 209/0289"
                value={formatAustrianTaxNumber(taxNumber)}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 9);
                  setTaxNumber(value);
                }}
                className="max-w-[180px] font-mono"
              />
              {taxNumber && taxNumber.length !== 9 && (
                <p className="text-sm text-amber-600">
                  Must be 9 digits (e.g., 29 209/0289)
                </p>
              )}
            </div>
          )}

          {/* Emails */}
          <div className="space-y-3">
            <div>
              <Label className="text-base">Email Addresses</Label>
              <p className="text-sm text-muted-foreground">
                Your email addresses (linked accounts auto-add their emails)
              </p>
            </div>
            <div className="flex gap-2 max-w-sm">
              <Input
                placeholder="e.g., info@company.de"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, handleAddEmail)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddEmail}
                disabled={!newEmail.trim()}
              >
                Add
              </Button>
            </div>
            {(inferredEmails.length > 0 || ownEmails.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {inferredEmails.map((email) => (
                  <Badge
                    key={`inferred-${email}`}
                    variant="outline"
                    className="gap-1 font-mono text-muted-foreground"
                  >
                    <Lock className="h-3 w-3" />
                    {email}
                  </Badge>
                ))}
                {ownEmails.map((email) => (
                  <Badge key={`own-${email}`} variant="secondary" className="gap-1 pr-1 font-mono">
                    {email}
                    <button
                      type="button"
                      onClick={() => handleRemoveEmail(email)}
                      className="ml-1 hover:bg-muted rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Personal Identity Card */}
          <div className="space-y-3">
            <Label className="text-base">Personal Identity</Label>
            <p className="text-sm text-muted-foreground -mt-1">
              Your freelancer/sole proprietor identity
            </p>
            <IdentityEntityCard
              entity={personalEntity}
              isPersonal
              onChange={handleUpdatePersonal}
              inferredIbans={inferredIbans}
            />
          </div>

          {/* Companies */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">Companies</Label>
                <p className="text-sm text-muted-foreground">
                  Additional business entities you operate as
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddCompany}>
                <Plus className="h-4 w-4 mr-2" />
                Add Company
              </Button>
            </div>

            {companies.length === 0 ? (
              <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
                <p>No companies added yet</p>
                <p className="text-sm mt-1">
                  Click &quot;Add Company&quot; to add a business entity
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {companies.map((company, index) => (
                  <IdentityEntityCard
                    key={company.id}
                    entity={company}
                    onChange={(updates) => handleUpdateCompany(index, updates)}
                    onDelete={() => handleDeleteCompany(index)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-4 pt-6 border-t">
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
            {saveSuccess && (
              <span className="text-sm text-green-600">Saved!</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
