"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BmdExportSection } from "@/components/settings/bmd-export-section";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";

export default function BmdExportPage() {
  const router = useRouter();
  usePageTitle("BMD NTCS Export");

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
