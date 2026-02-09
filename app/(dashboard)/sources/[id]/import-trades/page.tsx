"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useSources } from "@/hooks/use-sources";
import { useInvestmentImport } from "@/hooks/use-investment-import";
import { CSVDropzone } from "@/components/import/csv-dropzone";
import { MappingEditor } from "@/components/import/mapping-editor";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CSVAnalysis } from "@/types/import";
import { INVESTMENT_FIELDS } from "@/lib/import/investment-field-definitions";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Upload,
} from "lucide-react";

interface ImportTradesPageProps {
  params: Promise<{ id: string }>;
}

export default function ImportTradesPage({ params }: ImportTradesPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { sources, loading: sourcesLoading } = useSources();
  const source = sources.find((s) => s.id === id) || null;

  const {
    state,
    handleFileAnalyzed,
    updateMapping,
    updateMappingFormat,
    goToPreview,
    executeImport,
    reset,
  } = useInvestmentImport(source);

  const handleBack = () => {
    if (state.step === "mapping") {
      reset();
    } else if (state.step === "preview") {
      // Go back to mapping (state is preserved)
    } else {
      router.push(`/sources/${id}/trades`);
    }
  };

  if (sourcesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!source || source.accountKind !== "depot") {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Source not found or not a depot account.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Import Trades</h1>
          <p className="text-sm text-muted-foreground">{source.name}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "mapping", "preview", "importing", "complete"] as const).map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-border" />}
            <div
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                state.step === step
                  ? "bg-primary text-primary-foreground"
                  : ["importing", "complete"].includes(state.step) &&
                    ["upload", "mapping", "preview"].indexOf(step) < ["upload", "mapping", "preview"].indexOf(state.step)
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {step === "upload" ? "Upload" :
               step === "mapping" ? "Map Columns" :
               step === "preview" ? "Preview" :
               step === "importing" ? "Importing" : "Complete"}
            </div>
          </div>
        ))}
      </div>

      {/* Error display */}
      {state.error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Step content */}
      {state.step === "upload" && (
        <div className="space-y-4">
          <CSVDropzone
            onFileAnalyzed={(analysis: CSVAnalysis, file: File) => {
              handleFileAnalyzed(analysis, file);
            }}
          />
          {state.isMatching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI is analyzing your columns...
            </div>
          )}
        </div>
      )}

      {state.step === "mapping" && state.analysis && (
        <div className="space-y-4">
          <MappingEditor
            mappings={state.mappings}
            sampleRows={state.analysis.sampleRows}
            onMappingChange={updateMapping}
            onFormatChange={updateMappingFormat}
            fieldDefinitions={INVESTMENT_FIELDS}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>
              Start Over
            </Button>
            <Button onClick={goToPreview}>
              <ArrowRight className="h-4 w-4 mr-2" />
              Preview Import
            </Button>
          </div>
        </div>
      )}

      {state.step === "preview" && state.analysis && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-2">Import Summary</h3>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>{state.analysis.totalRows} rows detected</p>
                <p>Source: {source.name}</p>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Mapped Fields</h4>
                <div className="flex flex-wrap gap-2">
                  {state.mappings
                    .filter((m) => m.targetField)
                    .map((m) => (
                      <div key={m.csvColumn} className="text-xs bg-muted px-2 py-1 rounded">
                        {m.csvColumn} → {m.targetField}
                      </div>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                // Navigate back to mapping by resetting step
                // The mappings are preserved in state
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Mapping
            </Button>
            <Button onClick={executeImport}>
              <Upload className="h-4 w-4 mr-2" />
              Import {state.analysis.totalRows} Trades
            </Button>
          </div>
        </div>
      )}

      {state.step === "importing" && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-medium">
                {state.progress < 50 ? "Parsing trades..." : "Writing to database..."}
              </span>
            </div>
            <Progress value={state.progress} />
            <p className="text-xs text-muted-foreground">{state.progress}% complete</p>
          </CardContent>
        </Card>
      )}

      {state.step === "complete" && state.results && (
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <div>
              <h3 className="text-lg font-semibold">Import Complete</h3>
              <div className="text-sm text-muted-foreground mt-2 space-y-1">
                <p>{state.results.imported} trades imported</p>
                {state.results.skipped > 0 && (
                  <p>{state.results.skipped} duplicates skipped</p>
                )}
                {state.results.errors > 0 && (
                  <p className="text-destructive">{state.results.errors} errors</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                FIFO calculation is running in the background...
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={reset}>
                Import More
              </Button>
              <Button onClick={() => router.push(`/sources/${id}/trades`)}>
                View Trades
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
