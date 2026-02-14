"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import {
  Mail,
  AlertCircle,
  Loader2,
  Globe,
  Inbox,
  Bot,
  FileArchive,
  FileText,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEmailIntegrations } from "@/hooks/use-email-integrations";
import { useBrowserExtensionStatus } from "@/hooks/use-browser-extension";
import { useEmailInbound } from "@/hooks/use-email-inbound";
import { useAuth } from "@/components/auth/auth-provider";
import { useUserData } from "@/hooks/use-user-data";
import { useApiKeys } from "@/hooks/use-api-keys";
import { SettingsPageHeader } from "@/components/ui/settings-page-header";
import { IntegrationCard } from "@/components/integrations/integration-card";

interface AttentionItem {
  message: string;
  href: string;
}

function IntegrationsContent() {
  const extension = useBrowserExtensionStatus();
  const { integrations, loading: gmailLoading } = useEmailIntegrations();
  const { primaryAddress } = useEmailInbound();
  const { isAdmin } = useAuth();
  const { userData } = useUserData();
  const { keys } = useApiKeys();

  const gmailIntegrations = integrations.filter((i) => i.provider === "gmail");

  // --- Derive status strings ---
  const extensionStatus =
    extension.status === "checking"
      ? "Checking..."
      : extension.status === "installed"
        ? "Extension connected and ready"
        : "Not installed";

  const extensionBadge =
    extension.status === "installed"
      ? ({ label: "Installed", variant: "success" as const })
      : undefined;

  const gmailStatus = gmailLoading
    ? "Loading..."
    : gmailIntegrations.length === 0
      ? "No accounts connected"
      : gmailIntegrations.length === 1
        ? "1 account"
        : `${gmailIntegrations.length} accounts`;

  const gmailNeedsAttention = gmailIntegrations.some(
    (i) => i.needsReauth || i.lastSyncStatus === "failed"
  );

  const gmailBadge = gmailNeedsAttention
    ? ({ label: "Action needed", variant: "destructive" as const })
    : gmailIntegrations.length > 0
      ? ({ label: "Connected", variant: "success" as const })
      : undefined;

  const emailForwardingStatus = primaryAddress
    ? primaryAddress.isActive
      ? `${primaryAddress.emailsReceived} emails received`
      : "Paused"
    : "Setting up...";

  const emailForwardingBadge = primaryAddress
    ? primaryAddress.isActive
      ? ({ label: "Active", variant: "success" as const })
      : ({ label: "Paused", variant: "warning" as const })
    : undefined;

  const finanzonline = userData?.finanzonline;
  const finanzonlineStatus = finanzonline?.isConfigured
    ? finanzonline.connectionStatus === "valid"
      ? `Teilnehmer: ${finanzonline.teilnehmerId}`
      : finanzonline.connectionStatus === "invalid"
        ? "Connection invalid"
        : "Credentials saved, untested"
    : "Not configured";

  const finanzonlineBadge = finanzonline?.isConfigured
    ? finanzonline.connectionStatus === "valid"
      ? ({ label: "Connected", variant: "success" as const })
      : finanzonline.connectionStatus === "invalid"
        ? ({ label: "Invalid", variant: "destructive" as const })
        : ({ label: "Untested", variant: "warning" as const })
    : undefined;

  const activeKeyCount = keys.length;
  const apiKeysStatus =
    activeKeyCount === 0
      ? "No API keys"
      : activeKeyCount === 1
        ? "1 key active"
        : `${activeKeyCount} keys active`;

  const apiKeysBadge =
    activeKeyCount > 0
      ? ({ label: `${activeKeyCount} active`, variant: "success" as const })
      : undefined;

  // --- Attention banner ---
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];

    // Gmail accounts needing reauth or with failed syncs
    for (const i of gmailIntegrations) {
      if (i.needsReauth) {
        items.push({
          message: `Gmail (${i.email}) needs to be reconnected`,
          href: `/integrations/${i.id}`,
        });
      } else if (i.lastSyncStatus === "failed") {
        items.push({
          message: `Gmail (${i.email}) sync failed`,
          href: `/integrations/${i.id}`,
        });
      }
    }

    // Email forwarding paused
    if (primaryAddress && !primaryAddress.isActive) {
      items.push({
        message: "Email forwarding is paused",
        href: "/integrations/email-inbound",
      });
    }

    // FinanzOnline invalid (admin only)
    if (isAdmin && finanzonline?.isConfigured && finanzonline.connectionStatus === "invalid") {
      items.push({
        message: "FinanzOnline connection is invalid",
        href: "/integrations/finanzonline",
      });
    }

    return items;
  }, [gmailIntegrations, primaryAddress, isAdmin, finanzonline]);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <SettingsPageHeader
          title="Integrations"
          description="Connect external services to automatically find and match invoices"
          className="mb-0"
        />

        {/* Attention banner */}
        {attentionItems.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <ul className="space-y-1">
                {attentionItems.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="underline hover:no-underline">
                      {item.message}
                    </Link>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Invoice Sources */}
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Invoice Sources
          </h3>
          <div className="space-y-2">
            <IntegrationCard
              icon={<Globe className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
              iconBg="bg-emerald-100 dark:bg-emerald-900/40"
              name="Browser Plugin"
              status={extensionStatus}
              badge={extensionBadge}
              href="/integrations/browser"
            />
            <IntegrationCard
              icon={<Mail className="h-4 w-4 text-red-600 dark:text-red-400" />}
              iconBg="bg-red-100 dark:bg-red-900/40"
              name="Gmail"
              status={gmailStatus}
              badge={gmailBadge}
              href="/integrations/gmail"
            />
            <IntegrationCard
              icon={<Inbox className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
              iconBg="bg-purple-100 dark:bg-purple-900/40"
              name="Email Forwarding"
              status={emailForwardingStatus}
              badge={emailForwardingBadge}
              href="/integrations/email-inbound"
            />
            <IntegrationCard
              icon={<Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
              iconBg="bg-blue-100 dark:bg-blue-900/40"
              name="Microsoft Outlook"
              status="Connect your Outlook account"
              badge={{ label: "Coming Soon", variant: "muted" }}
              href="#"
              comingSoon
            />
          </div>
        </section>

        {/* Export & Tax */}
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Export & Tax
          </h3>
          <div className="space-y-2">
            <IntegrationCard
              icon={<FileArchive className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
              iconBg="bg-orange-100 dark:bg-orange-900/40"
              name="BMD NTCS Export"
              status="Export transactions for BMD"
              href="/integrations/bmd-export"
            />
            {isAdmin && (
              <IntegrationCard
                icon={<FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                iconBg="bg-blue-100 dark:bg-blue-900/40"
                name="FinanzOnline"
                status={finanzonlineStatus}
                badge={finanzonlineBadge}
                href="/integrations/finanzonline"
              />
            )}
          </div>
        </section>

        {/* Developer */}
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Developer
          </h3>
          <div className="space-y-2">
            <IntegrationCard
              icon={<Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" />}
              iconBg="bg-violet-100 dark:bg-violet-900/40"
              name="AI Agents"
              status={apiKeysStatus}
              badge={apiKeysBadge}
              href="/integrations/api-keys"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function IntegrationsFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function SettingsIntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsFallback />}>
      <IntegrationsContent />
    </Suspense>
  );
}
