"use client";

import { Badge } from "@/components/ui/badge";
import { InvoiceStatus } from "@/types/invoice";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Entwurf",
  issued: "Ausgestellt",
  sent: "Versendet",
  paid: "Bezahlt",
  cancelled: "Storniert",
};

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "bg-gray-100 text-gray-800 border-gray-300",
  issued: "bg-blue-50 text-blue-900 border-blue-300",
  sent: "bg-indigo-50 text-indigo-900 border-indigo-300",
  paid: "bg-green-50 text-green-900 border-green-300",
  cancelled: "bg-red-50 text-red-900 border-red-300",
};

interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
  className?: string;
}

export function InvoiceStatusBadge({
  status,
  className,
}: InvoiceStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("border", STATUS_CLASS[status], className)}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
