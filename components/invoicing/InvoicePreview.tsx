"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Invoice } from "@/types/invoice";
import { InvoiceDocument } from "./InvoiceDocument";
import { buildEpcPayload } from "@/lib/invoicing/epcPayload";

// @react-pdf/renderer is heavy and depends on browser-only APIs, so we
// dynamic-import its <PDFViewer> with ssr disabled.
const PDFViewer = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFViewer),
  { ssr: false }
);

interface InvoicePreviewProps {
  invoice: Invoice;
}

export function InvoicePreview({ invoice }: InvoicePreviewProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrReady, setQrReady] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const iban = invoice.issuer?.iban;
    if (!iban) {
      setQrDataUrl("");
      setQrReady(true);
      return;
    }
    const epc = buildEpcPayload({
      bic: invoice.issuer?.bic,
      name: invoice.issuer?.name ?? "",
      iban,
      amountCents: invoice.total ?? 0,
      remittance: invoice.number ? `Rechnung ${invoice.number}` : undefined,
    });
    QRCode.toDataURL(epc, { margin: 0, width: 256 })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrReady(true);
        }
      })
      .catch((err) => {
        console.error("EPC QR generation failed:", err);
        if (!cancelled) {
          setQrDataUrl("");
          setQrReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    invoice.issuer?.iban,
    invoice.issuer?.bic,
    invoice.issuer?.name,
    invoice.total,
    invoice.number,
  ]);

  if (!qrReady) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Vorschau wird erstellt…
      </div>
    );
  }

  return (
    <PDFViewer width="100%" height="100%" showToolbar={false}>
      <InvoiceDocument invoice={invoice} qrDataUrl={qrDataUrl || undefined} />
    </PDFViewer>
  );
}
