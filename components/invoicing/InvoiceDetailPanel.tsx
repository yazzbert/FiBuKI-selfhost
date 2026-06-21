"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Copy,
  Loader2,
  Send,
  Share2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import QRCode from "qrcode";
import { doc, onSnapshot } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PanelHeader } from "@/components/ui/detail-panel-primitives";
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
import { callFunction } from "@/lib/firebase/callable";
import { db } from "@/lib/firebase/config";
import { useInvoice } from "@/hooks/use-invoice";
import { useUserData } from "@/hooks/use-user-data";
import {
  DEFAULT_PAYMENT_TERMS,
  Invoice,
  InvoiceLineItem,
  composeInvoiceName,
  computeInvoiceTotals,
  parsePaymentTermsToDays,
} from "@/types/invoice";
import { TaxFile } from "@/types/file";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import { InvoiceLineItemsTable } from "./InvoiceLineItemsTable";
import {
  InvoiceRecipientField,
  SelectedRecipient,
} from "./InvoiceRecipientField";
import {
  InvoiceIssuerPicker,
  SelectedIssuer,
} from "./InvoiceIssuerPicker";
import { InvoiceShareLinkDialog } from "./InvoiceShareLinkDialog";
import { InvoiceDocument } from "./InvoiceDocument";
import { FilePreview } from "@/components/files/file-preview";
import { buildEpcPayload } from "@/lib/invoicing/epcPayload";

interface InvoiceDetailPanelProps {
  invoiceId: string;
  /** Optional file id (set once the invoice has been issued and the file exists). */
  fileId?: string | null;
  onClose: () => void;
  /**
   * Optional lift-up handler. When provided, the panel reports its current
   * preview source (downloadUrl + fileName + fileType) so the page can render
   * the standard `FileViewerOverlay` over the file list area. The panel still
   * works without this (the parent simply won't be able to open the overlay).
   */
  onPreviewSourceChange?: (
    source: { downloadUrl: string; fileName: string; fileType: string } | null
  ) => void;
  /** Whether the parent-rendered viewer is currently open (for thumbnail active state). */
  viewerOpen?: boolean;
  /** Toggles the parent-rendered viewer. */
  onToggleViewer?: () => void;
  /** Up-arrow navigation (previous row in the file list). */
  onNavigatePrevious?: () => void;
  /** Down-arrow navigation (next row in the file list). */
  onNavigateNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

// Convert Firestore Timestamp-ish to yyyy-MM-dd
function toDateInput(value: unknown): string {
  if (!value) return "";
  const d =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : (value as Date);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(input: string): Date | undefined {
  if (!input) return undefined;
  const d = new Date(input + "T00:00:00");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function addDaysToInputDate(input: string, days: number): string {
  const d = fromDateInput(input);
  if (!d) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatEur(cents: number): string {
  const safe = Math.round(cents);
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const euros = Math.floor(abs / 100);
  const remainder = abs % 100;
  const eurosStr = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${eurosStr},${String(remainder).padStart(
    2,
    "0"
  )} €`;
}

interface LocalForm {
  issuer: SelectedIssuer | null;
  recipient: SelectedRecipient | null;
  issueDate: string; // yyyy-MM-dd
  paymentTerms: string;
  dueDate: string; // yyyy-MM-dd
  lineItems: InvoiceLineItem[];
  notes: string;
  namePrefix: string;
  /** Stored as string so the user can clear/edit freely; parsed at save time. */
  numberSeq: string;
}

function invoiceToForm(invoice: Invoice): LocalForm {
  return {
    issuer: invoice.issuer
      ? { entityId: invoice.issuer.entityId, iban: invoice.issuer.iban }
      : null,
    recipient: invoice.recipient?.partnerId
      ? {
          partnerId: invoice.recipient.partnerId,
          partnerType: invoice.recipient.partnerType,
        }
      : null,
    issueDate: toDateInput(invoice.issueDate),
    paymentTerms: invoice.paymentTerms || DEFAULT_PAYMENT_TERMS,
    dueDate: toDateInput(invoice.dueDate),
    lineItems: invoice.lineItems ?? [],
    notes: invoice.notes ?? "",
    namePrefix: invoice.namePrefix ?? "",
    numberSeq:
      typeof invoice.numberSeq === "number"
        ? String(invoice.numberSeq)
        : "",
  };
}

function getInvoiceErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return "Unbekannter Fehler. Bitte versuche es erneut.";
}

export function InvoiceDetailPanel({
  invoiceId,
  fileId,
  onClose,
  onPreviewSourceChange,
  viewerOpen = false,
  onToggleViewer,
  onNavigatePrevious,
  onNavigateNext,
  hasPrevious = false,
  hasNext = false,
}: InvoiceDetailPanelProps) {
  const { invoice, loading } = useInvoice(invoiceId);
  const { userData } = useUserData();
  const [form, setForm] = useState<LocalForm | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRef = useRef(false);

  // Lightweight inline toast: show a dismissible error banner inside the
  // panel header. Auto-clears after 6s so it doesn't linger forever. The app
  // doesn't ship a global toast library, so this is the most consistent
  // pattern with the rest of the codebase (see InvoiceIssuerPicker).
  const showError = useCallback((message: string) => {
    setErrorBanner(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorBanner(null), 6000);
  }, []);
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Reactively re-snapshot the issuer when the user edits identity in another
  // tab. The backend re-snapshots whenever issuerEntityId is in the patch, so
  // we just resend the current ids and let the server pull fresh name / VAT /
  // address from userData.
  const issuerEntityId = invoice?.issuer?.entityId;
  const issuerIban = invoice?.issuer?.iban;
  const issuerSignature = useMemo(() => {
    if (!userData || !issuerEntityId) return null;
    const all = [
      userData.personalEntity,
      ...(userData.companies ?? []),
    ].filter((e): e is NonNullable<typeof e> => !!e);
    const entity = all.find((e) => e.id === issuerEntityId);
    if (!entity) return null;
    return JSON.stringify({
      name: entity.name ?? "",
      vatId: entity.vatId ?? "",
      address: entity.address ?? null,
    });
  }, [userData, issuerEntityId]);

  const lastIssuerSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!invoice || invoice.status !== "draft") return;
    if (!issuerEntityId || !issuerIban) return;
    if (issuerSignature === null) return;
    if (lastIssuerSignatureRef.current === null) {
      // First seen for this invoice — just remember.
      lastIssuerSignatureRef.current = issuerSignature;
      return;
    }
    if (lastIssuerSignatureRef.current === issuerSignature) return;
    lastIssuerSignatureRef.current = issuerSignature;
    // Fire-and-forget patch with same ids; server re-snapshots from userData.
    callFunction<
      { invoiceId: string; patch: Record<string, unknown> },
      { invoiceId: string; status: string }
    >("updateInvoice", {
      invoiceId,
      patch: { issuerEntityId, issuerIban },
    }).catch((err) => {
      console.error("Issuer re-snapshot failed:", err);
      showError(
        `Absender konnte nicht aktualisiert werden: ${getInvoiceErrorMessage(err)}`,
      );
    });
  }, [invoice, issuerEntityId, issuerIban, issuerSignature, invoiceId, showError]);

  // Reset the tracking ref when switching invoices
  useEffect(() => {
    lastIssuerSignatureRef.current = null;
  }, [invoiceId]);

  // Hydrate the local form from the invoice once it loads (and whenever the
  // invoice id changes).
  useEffect(() => {
    if (!invoice) return;
    if (initRef.current && form) return;
    initRef.current = true;
    setForm(invoiceToForm(invoice));
  }, [invoice, form]);

  // Reset hydration when switching invoices
  useEffect(() => {
    initRef.current = false;
    setForm(null);
  }, [invoiceId]);

  const isDraft = invoice?.status === "draft";
  // Editing is now allowed in any non-cancelled state. Cancelled invoices stay
  // locked because their accounting record must remain immutable.
  const disabled = invoice?.status === "cancelled";

  // ---------------------------------------------------------------------
  // Issued invoice: subscribe to the linked TaxFile so we can show its real
  // downloadUrl in the preview / overlay.
  // ---------------------------------------------------------------------
  const [issuedFile, setIssuedFile] = useState<TaxFile | null>(null);
  useEffect(() => {
    // Always clear synchronously when the fileId prop changes — otherwise
    // a brief render with the *previous* invoice's file leaks into the
    // memoized `previewSource` below, which the parent then lifts up and
    // the thumbnail click opens against a stale URL.
    setIssuedFile(null);
    if (!fileId) {
      return;
    }
    const unsub = onSnapshot(
      doc(db, "files", fileId),
      (snap) => {
        if (snap.exists()) {
          setIssuedFile({ id: snap.id, ...snap.data() } as TaxFile);
        } else {
          setIssuedFile(null);
        }
      },
      (err) => {
        console.error("InvoiceDetailPanel issuedFile snapshot error:", err);
        setIssuedFile(null);
      }
    );
    return () => unsub();
  }, [fileId]);

  // Debounced auto-save to updateInvoice while the invoice is a draft
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<string>("");

  // Throttle PDF regen for issued invoices so we don't hammer the backend
  // on every keystroke. We let updateInvoice fire on the regular autosave
  // cadence and only trigger regen at most every 5 seconds.
  const lastRegenRef = useRef<number>(0);
  const REGEN_THROTTLE_MS = 5000;
  const triggerRegen = useCallback(async () => {
    const now = Date.now();
    if (now - lastRegenRef.current < REGEN_THROTTLE_MS) return;
    lastRegenRef.current = now;
    try {
      await callFunction<
        { invoiceId: string },
        { downloadUrl: string }
      >("regenerateInvoicePdf", { invoiceId });
    } catch (err) {
      console.error("regenerateInvoicePdf (auto) failed:", err);
      showError(
        `PDF konnte nicht neu erzeugt werden: ${getInvoiceErrorMessage(err)}`,
      );
    }
  }, [invoiceId, showError]);

  const sendUpdate = useCallback(
    async (next: LocalForm) => {
      if (!invoice || invoice.status === "cancelled") return;
      const patch: Record<string, unknown> = {
        paymentTerms: next.paymentTerms,
        lineItems: next.lineItems,
        notes: next.notes,
        namePrefix: next.namePrefix.trim() === "" ? null : next.namePrefix.trim(),
      };
      // Only send numberSeq when it parses to a valid positive integer to
      // avoid bouncing off the server validation while the user is mid-typing.
      const parsedSeq = parseInt(next.numberSeq, 10);
      if (Number.isInteger(parsedSeq) && parsedSeq >= 1 && parsedSeq <= 9999) {
        patch.numberSeq = parsedSeq;
      }
      if (next.issueDate) {
        patch.issueDate = fromDateInput(next.issueDate)?.toISOString();
      }
      if (next.dueDate) {
        patch.dueDate = fromDateInput(next.dueDate)?.toISOString();
      }
      if (next.recipient) {
        patch.partnerId = next.recipient.partnerId;
        patch.partnerType = next.recipient.partnerType;
      }
      if (next.issuer) {
        patch.issuerEntityId = next.issuer.entityId;
        patch.issuerIban = next.issuer.iban;
      }
      const snapshot = JSON.stringify(patch);
      if (snapshot === lastSentRef.current) return;
      lastSentRef.current = snapshot;
      try {
        await callFunction<
          { invoiceId: string; patch: Record<string, unknown> },
          { invoiceId: string; status: string }
        >("updateInvoice", { invoiceId, patch });
        // Auto-regenerate the PDF after edits to issued invoices so the
        // user-visible PDF stays in sync. Drafts render the PDF client-side
        // via @react-pdf/renderer, so no regen needed there.
        if (invoice.status !== "draft") {
          triggerRegen();
        }
      } catch (err) {
        console.error("updateInvoice failed:", err);
        showError(
          `Änderungen konnten nicht gespeichert werden: ${getInvoiceErrorMessage(err)}`,
        );
      }
    },
    [invoice, invoiceId, showError, triggerRegen]
  );

  const queueSave = useCallback(
    (next: LocalForm) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        sendUpdate(next);
      }, 500);
    },
    [sendUpdate]
  );

  // Cleanup pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Phantom draft cleanup: when the panel unmounts (close, navigate away,
  // invoice id changes), delete the underlying invoice if it's still an
  // empty draft. We always read the most recent invoice/form via refs so
  // the cleanup callback doesn't capture stale state.
  // ---------------------------------------------------------------------
  const invoiceRef = useRef<Invoice | null>(null);
  const formRef = useRef<LocalForm | null>(null);
  useEffect(() => {
    invoiceRef.current = invoice ?? null;
  }, [invoice]);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    const idAtMount = invoiceId;
    return () => {
      const inv = invoiceRef.current;
      const f = formRef.current;
      // Only act on the invoice this effect was tied to.
      if (!inv || inv.id !== idAtMount) return;
      if (inv.status !== "draft") return;

      // "Empty" definition: prefer the local form state if available
      // (captures unflushed edits), otherwise fall back to the persisted
      // invoice document.
      const lineItems = f?.lineItems ?? inv.lineItems ?? [];
      const allItemsEmpty =
        lineItems.length === 0 ||
        lineItems.every(
          (li) => !li.description?.trim() && (li.unitPrice ?? 0) === 0
        );
      const recipientPartnerId = f?.recipient?.partnerId ?? inv.recipient?.partnerId ?? "";
      const notesValue = (f?.notes ?? inv.notes ?? "").trim();
      const isEmpty =
        allItemsEmpty && recipientPartnerId === "" && notesValue === "";

      if (!isEmpty) return;

      // Cancel any pending debounced save BEFORE deleting so we don't
      // race the autosave back into a freshly-deleted doc.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      // Fire-and-forget: swallow errors silently (the invoice may have
      // already been issued, deleted, or otherwise transitioned out of
      // draft state in the meantime).
      callFunction<{ invoiceId: string }, { success: boolean }>(
        "deleteInvoice",
        { invoiceId: idAtMount }
      ).catch(() => undefined);
    };
  }, [invoiceId]);

  const updateForm = useCallback(
    (patch: Partial<LocalForm>) => {
      setForm((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        // Auto-recompute due date when issueDate or paymentTerms change
        if ("issueDate" in patch || "paymentTerms" in patch) {
          const days = parsePaymentTermsToDays(next.paymentTerms);
          if (next.issueDate) {
            next.dueDate = addDaysToInputDate(next.issueDate, days);
          }
        }
        queueSave(next);
        return next;
      });
    },
    [queueSave]
  );

  // Live totals (preview will reflect them via onSnapshot once saved)
  const liveTotals = useMemo(() => {
    if (!form) return { subtotal: 0, vatAmount: 0, total: 0 };
    return computeInvoiceTotals(form.lineItems);
  }, [form]);

  // Live composed name — uses the user's in-progress edits so the sidebar
  // header reflects what the issued invoice will be called BEFORE save.
  const liveDisplayName = useMemo(() => {
    if (!invoice) return "(Entwurf)";
    // Issued invoices already have a frozen number — show it as-is.
    if (invoice.number && !invoice.number.startsWith("DRAFT-")) {
      return invoice.number;
    }
    const yearStr = form?.issueDate?.slice(0, 4);
    const year = yearStr ? parseInt(yearStr, 10) : undefined;
    const parsedSeq = form ? parseInt(form.numberSeq, 10) : NaN;
    return composeInvoiceName({
      namePrefix: form?.namePrefix,
      recipientName: invoice.recipient?.name,
      year:
        Number.isInteger(year) && year !== undefined && year > 0
          ? year
          : invoice.issueDate?.toDate().getFullYear(),
      numberSeq:
        Number.isInteger(parsedSeq) && parsedSeq >= 1
          ? parsedSeq
          : invoice.numberSeq,
    });
  }, [invoice, form]);

  // Compute issuability for the sticky-footer button. We list every missing
  // field individually so the user knows exactly what to fill in.
  const issuabilityIssues = useMemo<string[]>(() => {
    if (!form) return [];
    const issues: string[] = [];
    if (!form.recipient?.partnerId) issues.push("Empfänger");
    if (!form.issuer?.entityId) issues.push("Absender");
    if (!form.issuer?.iban) issues.push("Absender-IBAN");
    const hasValidLine = form.lineItems.some(
      (li) =>
        li.description.trim() !== "" &&
        (li.unitPrice ?? 0) > 0 &&
        (li.quantity ?? 0) > 0,
    );
    if (!hasValidLine) issues.push("mindestens eine Position mit Preis");
    return issues;
  }, [form]);
  const canIssue = issuabilityIssues.length === 0;

  // ---------------------------------------------------------------------
  // Live PDF preview (drafts only)
  //
  // We render the React-PDF document to a Blob, then create an object URL so
  // it can be passed to <FilePreview> (thumbnail) and <FileViewerOverlay>
  // (full overlay). The rendering is debounced ~300ms to avoid thrashing
  // while the user is typing.
  // ---------------------------------------------------------------------
  const [draftBlobUrl, setDraftBlobUrl] = useState<string | null>(null);
  const [draftRendering, setDraftRendering] = useState(false);
  const previousBlobUrlRef = useRef<string | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const livePreviewInvoice: Invoice | null = useMemo(() => {
    if (!invoice || !form) return null;
    return {
      ...invoice,
      lineItems: form.lineItems,
      notes: form.notes,
      ...computeInvoiceTotals(form.lineItems),
    };
  }, [invoice, form]);

  // Keep the latest livePreviewInvoice in a ref so the render effect can
  // read it WITHOUT re-running every time the object identity changes.
  // We only want the render to re-fire when the PDF-relevant *content*
  // changes (see signature below).
  const livePreviewInvoiceRef = useRef<Invoice | null>(null);
  livePreviewInvoiceRef.current = livePreviewInvoice;

  // Stable content signature for the PDF — only the fields the PDF
  // actually renders. Without this, the effect re-fires every time the
  // Firestore onSnapshot pushes a new `invoice` object reference (even
  // when nothing relevant changed), which caused the "renders twice on
  // create" bug: 1st render from the initial empty draft snapshot, 2nd
  // from the re-snapshot triggered by the issuer-signature autosave.
  const previewSignature = useMemo(() => {
    if (!livePreviewInvoice) return null;
    return JSON.stringify({
      n: livePreviewInvoice.number,
      i: livePreviewInvoice.issuer,
      r: livePreviewInvoice.recipient,
      iso: livePreviewInvoice.issueDate?.toDate?.()?.toISOString?.() ?? null,
      dso: livePreviewInvoice.dueDate?.toDate?.()?.toISOString?.() ?? null,
      pt: livePreviewInvoice.paymentTerms,
      li: livePreviewInvoice.lineItems,
      no: livePreviewInvoice.notes,
      cu: livePreviewInvoice.currency,
      t: livePreviewInvoice.total,
    });
  }, [livePreviewInvoice]);

  useEffect(() => {
    // Only generate live blob URLs for drafts
    if (!isDraft || !previewSignature) {
      return;
    }

    let cancelled = false;
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    setDraftRendering(true);

    renderTimerRef.current = setTimeout(async () => {
      const current = livePreviewInvoiceRef.current;
      if (!current) {
        setDraftRendering(false);
        return;
      }
      try {
        // Generate EPC QR if we have an IBAN
        let qrDataUrl: string | undefined;
        const iban = current.issuer?.iban;
        if (iban) {
          const epc = buildEpcPayload({
            bic: current.issuer?.bic,
            name: current.issuer?.name ?? "",
            iban,
            amountCents: current.total ?? 0,
            remittance: current.number
              ? `Rechnung ${current.number}`
              : undefined,
          });
          try {
            qrDataUrl = await QRCode.toDataURL(epc, { margin: 0, width: 256 });
          } catch (err) {
            console.warn("EPC QR generation failed:", err);
          }
        }

        // Dynamic import to keep @react-pdf/renderer out of the initial bundle
        const { pdf } = await import("@react-pdf/renderer");
        const blob = await pdf(
          <InvoiceDocument
            invoice={current}
            qrDataUrl={qrDataUrl}
          />
        ).toBlob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        // Revoke the previous URL after we set the new one, so any consumers
        // currently displaying the old URL aren't left with a dangling ref
        // mid-frame.
        const prev = previousBlobUrlRef.current;
        previousBlobUrlRef.current = url;
        setDraftBlobUrl(url);
        setDraftRendering(false);
        if (prev) {
          // Small delay to let consumers swap to the new URL
          setTimeout(() => URL.revokeObjectURL(prev), 0);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Live invoice PDF render failed:", err);
          setDraftRendering(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    };
  }, [isDraft, previewSignature]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (previousBlobUrlRef.current) {
        URL.revokeObjectURL(previousBlobUrlRef.current);
        previousBlobUrlRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Active preview source — draft blob for drafts, issued file URL otherwise.
  // ---------------------------------------------------------------------
  const previewSource = useMemo(() => {
    if (isDraft) {
      if (!draftBlobUrl) return null;
      const fileName =
        liveDisplayName && liveDisplayName !== "(Entwurf)"
          ? `${liveDisplayName}.pdf`
          : "Rechnungsentwurf.pdf";
      return {
        downloadUrl: draftBlobUrl,
        fileName,
        fileType: "application/pdf",
      };
    }
    if (issuedFile && issuedFile.downloadUrl) {
      return {
        downloadUrl: issuedFile.downloadUrl,
        fileName: issuedFile.fileName,
        fileType: issuedFile.fileType || "application/pdf",
      };
    }
    return null;
  }, [isDraft, draftBlobUrl, liveDisplayName, issuedFile]);

  // Lift preview source up to the page so it can render the standard
  // FileViewerOverlay over the file list area.
  useEffect(() => {
    onPreviewSourceChange?.(previewSource);
  }, [onPreviewSourceChange, previewSource]);

  // Reset the lifted preview source IMMEDIATELY whenever the invoice id
  // changes. Without this, navigating between two OLD issued invoices
  // leaves the parent holding the previous file's downloadUrl until the
  // new file snapshot arrives — and any click on the thumbnail in the
  // meantime opens the stale preview (or appears to do nothing if the
  // stale source has already been GC'd). We push null first so the
  // overlay can't open against a stale URL; the next effect re-pushes
  // the fresh source as soon as it's computed.
  useEffect(() => {
    onPreviewSourceChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // Clear the lifted state on unmount.
  useEffect(() => {
    return () => {
      onPreviewSourceChange?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------

  const ACTION_ERROR_LABELS: Record<string, string> = {
    issue: "Rechnung konnte nicht ausgestellt werden",
    cancel: "Rechnung konnte nicht storniert werden",
    duplicate: "Rechnung konnte nicht dupliziert werden",
    regen: "PDF konnte nicht neu erzeugt werden",
  };

  const doAction = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setActionBusy(name);
      try {
        await fn();
      } catch (err) {
        console.error(`${name} failed:`, err);
        const label = ACTION_ERROR_LABELS[name] || "Aktion fehlgeschlagen";
        showError(`${label}: ${getInvoiceErrorMessage(err)}`);
      } finally {
        setActionBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showError]
  );

  const handleIssue = () =>
    doAction("issue", async () => {
      // Flush pending edits first
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (form) await sendUpdate(form);
      }
      await callFunction<
        { invoiceId: string; createShareLink?: boolean },
        { invoiceId: string; fileId: string; downloadUrl: string }
      >("issueInvoice", { invoiceId });
    });

  const handleCancel = () =>
    doAction("cancel", async () => {
      await callFunction<
        { invoiceId: string },
        { invoiceId: string; status: string }
      >("cancelInvoice", { invoiceId });
      // Close the sidebar after a successful cancel — the invoice is no
      // longer something the user is actively working with, and leaving the
      // panel open showing a now-cancelled record is just clutter.
      onClose();
    });

  const handleDuplicate = () =>
    doAction("duplicate", async () => {
      const res = await callFunction<
        { invoiceId: string },
        { invoiceId: string; fileId?: string }
      >("duplicateInvoice", { invoiceId });
      // Navigate to the new draft via its file row so it highlights in the
      // list. Falls back to ?invoiceId= for legacy responses without fileId.
      if (res.invoiceId && typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (res.fileId) {
          params.set("id", res.fileId);
          params.delete("invoiceId");
        } else {
          params.set("invoiceId", res.invoiceId);
          params.delete("id");
        }
        window.history.pushState({}, "", `/files?${params.toString()}`);
      }
    });

  // -----------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------

  if (loading || !invoice || !form) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Header — uses the shared PanelHeader so the visual treatment
            matches the file-detail-panel exactly (h-[53px], text-lg title,
            navigation arrows). For non-draft invoices we omit the status
            badge (the file list already conveys "issued/sent/paid" via the
            row state) so the header doesn't stand out vs. regular files.
            Drafts keep the "Entwurf" badge because that state is meaningful
            to the user during editing. */}
        <PanelHeader
          title={`Rechnung ${liveDisplayName}`}
          onClose={onClose}
          onNavigatePrevious={onNavigatePrevious}
          onNavigateNext={onNavigateNext}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
        >
          {invoice.status === "draft" && (
            <InvoiceStatusBadge status={invoice.status} />
          )}
        </PanelHeader>

        {errorBanner && (
          <div className="flex-shrink-0 border-b bg-destructive/10 text-destructive px-4 py-2 text-xs flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span className="flex-1">{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="flex-shrink-0 opacity-70 hover:opacity-100"
              aria-label="Hinweis schließen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Body: single-column editor with embedded preview thumbnail */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Preview thumbnail row — mirrors file-detail-panel's layout */}
            <div className="flex gap-4 file-preview-section">
              <div className="w-1/4 flex-shrink-0 file-preview-thumb">
                {previewSource ? (
                  <>
                    <FilePreview
                      downloadUrl={previewSource.downloadUrl}
                      fileType={previewSource.fileType}
                      fileName={previewSource.fileName}
                      onClick={onToggleViewer}
                      active={viewerOpen}
                    />
                    {/* Fixed-width caption so its width doesn't pulse between
                        "Klicken zum Schließen" and the shorter "Aktualisiere…"
                        which causes the surrounding layout to jump. */}
                    <p className="text-xs text-muted-foreground text-center mt-1 mx-auto" style={{ minWidth: "13ch" }}>
                      {draftRendering
                        ? "Aktualisiere…"
                        : viewerOpen
                          ? "Klicken zum Schließen"
                          : "Klicken zum Öffnen"}
                    </p>
                  </>
                ) : (
                  <div className="aspect-[3/4] rounded-md border border-dashed bg-muted/30 flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Vorschau wird erstellt…
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2 text-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  {isDraft ? "Entwurf" : "Rechnung"}
                </div>
                <div className="text-base font-semibold truncate">
                  {liveDisplayName}
                </div>
                {invoice.recipient?.name && (
                  <div className="text-muted-foreground truncate">
                    {invoice.recipient.name}
                  </div>
                )}
                <div className="tabular-nums font-medium">
                  {formatEur(liveTotals.total)}
                </div>
              </div>
            </div>

            <Separator />

            {/* Naming + sequence — sits above the Absender so the user sees
                the invoice number first. Both fields are optional; when
                empty the displayed name falls back to a 3-letter recipient
                abbreviation + auto-incremented sequence. */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Rechnungs-Nummerierung
              </Label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="invoice-name-prefix"
                    className="text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Rechnungsname
                  </Label>
                  <Input
                    id="invoice-name-prefix"
                    value={form.namePrefix}
                    onChange={(e) =>
                      updateForm({ namePrefix: e.target.value })
                    }
                    placeholder="z. B. INV"
                    maxLength={16}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="invoice-number-seq"
                    className="text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Nummer
                  </Label>
                  <Input
                    id="invoice-number-seq"
                    type="number"
                    min={1}
                    max={9999}
                    inputMode="numeric"
                    value={form.numberSeq}
                    onChange={(e) =>
                      updateForm({
                        numberSeq: e.target.value.replace(/[^0-9]/g, ""),
                      })
                    }
                    className="w-24 tabular-nums"
                    placeholder="0001"
                    disabled={disabled}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Vorschau: <span className="font-mono">{liveDisplayName}</span>
              </p>
            </div>

            <Separator />

            <InvoiceIssuerPicker
              value={form.issuer}
              onChange={(issuer) => updateForm({ issuer })}
              disabled={disabled}
            />

            <Separator />

            <InvoiceRecipientField
              value={form.recipient}
              onChange={(recipient) => updateForm({ recipient })}
              disabled={disabled}
            />

            <Separator />

            {/* "Zahlungsfrist" (the verbose payment-terms text) used to live
                here, but it duplicates the explicit due date. Removed —
                users who want custom payment-terms wording can use the
                Notiz field below the line items. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Rechnungsdatum
                </Label>
                <Input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) =>
                    updateForm({ issueDate: e.target.value })
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Fällig am
                </Label>
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) =>
                    updateForm({ dueDate: e.target.value })
                  }
                  disabled={disabled}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Positionen
              </Label>
              <InvoiceLineItemsTable
                lineItems={form.lineItems}
                onChange={(lineItems) => updateForm({ lineItems })}
                disabled={disabled}
              />
            </div>

            <div className="space-y-1 text-sm tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Netto</span>
                <span>{formatEur(liveTotals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">USt.</span>
                <span>{formatEur(liveTotals.vatAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                <span>Gesamt</span>
                <span>{formatEur(liveTotals.total)}</span>
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Notiz
              </Label>
              <textarea
                value={form.notes}
                onChange={(e) => updateForm({ notes: e.target.value })}
                disabled={disabled}
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Optionaler Hinweis am Ende der Rechnung…"
              />
            </div>

            {invoice.status === "cancelled" && (
              <div className="text-xs text-muted-foreground bg-muted/40 border rounded-md p-2 flex items-start gap-2">
                <XCircle className="h-3.5 w-3.5 mt-0.5" />
                <span>
                  Diese Rechnung wurde storniert und ist nicht mehr
                  editierbar. Dupliziere sie, um einen neuen Entwurf zu
                  erstellen.
                </span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Sticky footer actions — mirrors the partner/file detail panel
            pattern (`p-4 border-t` at the bottom of the column). Buttons
            are status-aware. During draft we intentionally show only the
            primary "Ausstellen" action: closing the sidebar auto-deletes
            an empty draft (see phantom-cleanup effect above), so Löschen
            is redundant, and Duplizieren of a half-filled draft is
            confusing. */}
        {/* "What's missing" hint — sits directly above the sticky footer.
            Only visible for draft invoices that aren't yet issuable. */}
        {invoice.status === "draft" && issuabilityIssues.length > 0 && (
          <div className="flex-shrink-0 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            Fehlend: {issuabilityIssues.join(", ")}
          </div>
        )}

        <div className="flex-shrink-0 border-t bg-background p-4 space-y-2">
          {invoice.status === "draft" && (
            <Button
              className="w-full"
              onClick={handleIssue}
              disabled={actionBusy !== null || !canIssue}
            >
              {actionBusy === "issue" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Ausstellen
            </Button>
          )}
          {(invoice.status === "issued" || invoice.status === "sent") && (
            <>
              {/* Share + Duplicate sit in a single 2-column row so the
                  destructive action stands alone below them. */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShareOpen(true)}
                  disabled={actionBusy !== null}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Teilen
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDuplicate}
                  disabled={actionBusy !== null}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Duplizieren
                </Button>
              </div>
              {/* Labelled "Löschen" per UX: the underlying server action is
                  still cancelInvoice (no hard delete), but the user mental
                  model maps to "delete" — there's no separate notion of a
                  cancelled-but-not-deleted invoice in this UI. */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={actionBusy !== null}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Löschen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rechnung löschen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Die Rechnung wird gelöscht und das verknüpfte PDF wird
                      ausgeblendet. Dieser Schritt lässt sich nicht rückgängig
                      machen — du kannst die Rechnung aber duplizieren, um
                      einen neuen Entwurf zu erstellen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={actionBusy === "cancel"}>
                      Abbrechen
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleCancel}
                      disabled={actionBusy !== null}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {actionBusy === "cancel" && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      Löschen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {invoice.status === "paid" && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => setShareOpen(true)}
                disabled={actionBusy !== null}
              >
                <Share2 className="h-4 w-4 mr-2" />
                Teilen
              </Button>
              <Button
                variant="outline"
                onClick={handleDuplicate}
                disabled={actionBusy !== null}
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplizieren
              </Button>
            </div>
          )}
          {invoice.status === "cancelled" && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleDuplicate}
              disabled={actionBusy !== null}
            >
              <Copy className="h-4 w-4 mr-2" />
              Duplizieren
            </Button>
          )}
        </div>
      </div>

      <InvoiceShareLinkDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        invoiceId={invoiceId}
        existingToken={invoice.shareToken}
      />
    </>
  );
}
