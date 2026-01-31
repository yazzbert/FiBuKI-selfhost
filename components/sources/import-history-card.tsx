"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileSpreadsheet,
  Trash2,
  Loader2,
  ChevronRight,
  Settings2,
  RefreshCw,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ImportRecord } from "@/types/import";

interface ImportHistoryCardProps {
  imports: ImportRecord[];
  loading: boolean;
  sourceId: string;
  onDeleteImport: (importId: string) => Promise<void>;
  isApiConnected?: boolean;
  onSync?: () => void;
  isSyncing?: boolean;
}

export function ImportHistoryCard({
  imports,
  loading,
  sourceId,
  onDeleteImport,
  isApiConnected = false,
  onSync,
  isSyncing = false,
}: ImportHistoryCardProps) {
  // Use different title and icon for API-connected accounts
  const title = isApiConnected ? "Sync History" : "Import History";
  const Icon = isApiConnected ? RefreshCw : FileSpreadsheet;
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleEditMapping = (e: React.MouseEvent, importId: string) => {
    e.stopPropagation();
    router.push(`/sources/${sourceId}/import/${importId}/edit`);
  };

  const handleDelete = async (importId: string) => {
    setDeletingId(importId);
    try {
      await onDeleteImport(importId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleRowClick = (importId: string) => {
    router.push(`/transactions?importId=${importId}`);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
          {onSync && (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (imports.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
          {onSync && (
            <Button variant="outline" size="sm" onClick={onSync} disabled={isSyncing}>
              {isSyncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isSyncing ? "Syncing..." : "Sync"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            {isApiConnected ? "No syncs yet." : "No imports yet."}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Helper to format sync date range
  const formatSyncRange = (from?: string, to?: string) => {
    if (!from || !to) return "";
    try {
      const fromDate = parseISO(from);
      const toDate = parseISO(to);
      return `${format(fromDate, "MMM d")} - ${format(toDate, "MMM d, yyyy")}`;
    } catch {
      return `${from} - ${to}`;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
        {onSync && (
          <Button variant="outline" size="sm" onClick={onSync} disabled={isSyncing}>
            {isSyncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {isSyncing ? "Syncing..." : "Sync"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {imports.map((imp) => {
          const isApiSync = imp.importType === "api";

          return (
            <div
              key={imp.id}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer group"
              onClick={() => handleRowClick(imp.id)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-1.5 rounded bg-muted shrink-0">
                  {isApiSync ? (
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {isApiSync ? (
                      <>
                        {format(imp.createdAt.toDate(), "MMM d, yyyy 'at' HH:mm")}
                      </>
                    ) : (
                      <>
                        {format(imp.createdAt.toDate(), "MMM d, yyyy")} - {imp.fileName}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isApiSync ? (
                      <>
                        {imp.importedCount ?? 0} synced
                        {(imp.skippedCount ?? 0) > 0 && `, ${imp.skippedCount} skipped`}
                        {imp.syncDateFrom && imp.syncDateTo && (
                          <span className="text-muted-foreground/70">
                            {" "}&middot; {formatSyncRange(imp.syncDateFrom, imp.syncDateTo)}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {imp.importedCount ?? 0} imported, {imp.skippedCount ?? 0} skipped,{" "}
                        {imp.errorCount ?? 0} errors
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Edit Mapping Button - only shown for CSV imports with stored CSV */}
                {!isApiSync && imp.csvStoragePath && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100"
                          onClick={(e) => handleEditMapping(e, imp.id)}
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit column mapping</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                      disabled={deletingId === imp.id}
                    >
                      {deletingId === imp.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {isApiSync ? "Delete Sync Record?" : "Delete Import?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This will delete the {isApiSync ? "sync" : "import"} record and all{" "}
                        {imp.importedCount ?? 0} transactions
                        {isApiSync ? " from this sync" : ` imported from "${imp.fileName}"`}.
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(imp.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
