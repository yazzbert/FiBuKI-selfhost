"use client";

import { ExportSection } from "@/components/settings/export-section";
import { ImportSection } from "@/components/settings/import-section";
import { SettingsPageHeader } from "@/components/ui/settings-page-header";

export default function ImportExportPage() {
  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Import / Export"
        description="Backup your data or restore from a previous export"
        className="mb-0"
      />

      <ExportSection />
      <ImportSection />
    </div>
  );
}
