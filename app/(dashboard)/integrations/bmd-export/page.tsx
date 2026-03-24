"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BmdExportSection } from "@/components/settings/bmd-export-section";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import { useSubscription } from "@/hooks/use-subscription";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

export default function BmdExportPage() {
  const router = useRouter();
  const { hasFeature, loading } = useSubscription();
  usePageTitle("BMD NTCS Export");

  if (loading) return null;

  if (!hasFeature("bmdExport")) {
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
            <h1 className="text-xl font-semibold">BMD NTCS Export</h1>
          </div>
          <Card>
            <CardContent className="py-8 text-center space-y-2">
              <p className="text-muted-foreground">
                BMD/NTCS Export is available as an addon.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/billing">Activate in Billing</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
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
            <h1 className="text-xl font-semibold">BMD NTCS Export</h1>
            <p className="text-sm text-muted-foreground">
              Export transactions for BMD accounting software
            </p>
          </div>
        </div>

        <BmdExportSection />
      </div>
    </div>
  );
}
