"use client";

import { SettingsPageHeader } from "@/components/ui/settings-page-header";
import { DigestToggle } from "@/components/billing/digest-toggle";
import { useSubscription } from "@/hooks/use-subscription";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsPage() {
  const { subscription, loading } = useSubscription();

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsPageHeader
          title="Notifications"
          description="Manage your email notification preferences"
        />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Notifications"
        description="Manage your email notification preferences"
      />
      <DigestToggle subscription={subscription} />
    </div>
  );
}
