import { Suspense } from "react";
import type { Metadata } from "next";
import { ExpandPageContent } from "@/components/expand/expand-page-content";

export const metadata: Metadata = {
  title: "Help FiBuKI get PSD2 banking in more countries",
  description:
    "FiBuKI connects directly to your bank via PSD2. Help us expand to your country — back with €10 and unlock direct bank connections in your region.",
  openGraph: {
    title: "Help FiBuKI get PSD2 banking in more countries",
    description:
      "Back your country with €10 to help activate PSD2 bank connections. Your payment becomes credit toward your first month.",
    url: "https://fibuki.com/expand",
    siteName: "FiBuKI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Help FiBuKI get PSD2 banking in more countries",
    description:
      "Back your country with €10 to help activate PSD2 bank connections.",
  },
};

export default function ExpandPage() {
  return (
    <Suspense>
      <ExpandPageContent />
    </Suspense>
  );
}
