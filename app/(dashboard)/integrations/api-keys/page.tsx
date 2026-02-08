"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiKeysSection } from "@/components/settings/api-keys-section";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";

export default function ApiKeysPage() {
  const router = useRouter();
  usePageTitle("AI Agents");

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
            <h1 className="text-xl font-semibold">AI Agents</h1>
            <p className="text-sm text-muted-foreground">
              Manage API keys for AI agent access
            </p>
          </div>
        </div>

        <ApiKeysSection />
      </div>
    </div>
  );
}
