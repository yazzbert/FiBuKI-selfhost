"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Loader2, Link as LinkIcon, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callFunction } from "@/lib/firebase/callable";

interface InvoiceShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  /** Existing share token (read from invoice). If absent, dialog offers to create one. */
  existingToken?: string;
}

function buildShareUrl(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://fibuki.com";
  return `${origin}/i/${token}`;
}

export function InvoiceShareLinkDialog({
  open,
  onOpenChange,
  invoiceId,
  existingToken,
}: InvoiceShareLinkDialogProps) {
  const [token, setToken] = useState<string | undefined>(existingToken);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setToken(existingToken);
  }, [existingToken, open]);

  const url = token ? buildShareUrl(token) : "";

  const handleCreate = async () => {
    setWorking(true);
    try {
      const res = await callFunction<
        { invoiceId: string },
        { token: string; shareUrl: string }
      >("createInvoiceShareLink", { invoiceId });
      setToken(res.token);
    } catch (err) {
      console.error("Failed to create share link:", err);
    } finally {
      setWorking(false);
    }
  };

  const handleRevoke = async () => {
    setWorking(true);
    try {
      await callFunction<{ invoiceId: string }, { success: boolean }>(
        "revokeInvoiceShareLink",
        { invoiceId }
      );
      setToken(undefined);
    } catch (err) {
      console.error("Failed to revoke share link:", err);
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechnung teilen</DialogTitle>
        </DialogHeader>

        {token ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Jeder mit diesem Link kann die Rechnung als PDF abrufen.
            </p>
            <div className="flex gap-2">
              <Input value={url} readOnly className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                title="In Zwischenablage kopieren"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Erzeuge einen öffentlichen Link, damit Empfänger die Rechnung ohne
              Login abrufen können.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {token ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleRevoke}
              disabled={working}
              className="text-destructive hover:text-destructive"
            >
              {working ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Link widerrufen
            </Button>
          ) : (
            <Button type="button" onClick={handleCreate} disabled={working}>
              {working ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LinkIcon className="h-4 w-4 mr-2" />
              )}
              Link erstellen
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
