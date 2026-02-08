"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FinanzOnlineIntegrationCard } from "@/components/settings/finanzonline-integration-card";
import { useAuth } from "@/components/auth/auth-provider";
import { usePageTitle } from "@/hooks/use-page-title";

export default function FinanzOnlinePage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();
  usePageTitle("FinanzOnline");

  // Admin guard — redirect non-admins
  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/settings/integrations");
    }
  }, [loading, isAdmin, router]);

  if (loading || !isAdmin) {
    return null;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/settings/integrations")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">FinanzOnline</h1>
            <p className="text-sm text-muted-foreground">
              Submit UVA directly to Austrian tax authority
            </p>
          </div>
        </div>

        <FinanzOnlineIntegrationCard />
      </div>
    </div>
  );
}
