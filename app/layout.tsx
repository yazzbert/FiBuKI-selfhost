import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { bodyFont, logoFont } from "@/app/fonts";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";

export const metadata: Metadata = {
  title: "FiBuKI - Tax Management Tool",
  description: "Manage your transactions and receipts for tax purposes",
  openGraph: {
    title: "FiBuKI - Bank Access for AI-natives",
    description: "Manage your transactions and receipts for tax purposes",
    url: "https://fibuki.com",
    siteName: "FiBuKI",
    images: [
      {
        url: "https://fibuki.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "FiBuKI - Bank Access for AI-natives",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FiBuKI - Bank Access for AI-natives",
    description: "Manage your transactions and receipts for tax purposes",
    images: ["https://fibuki.com/og-image.png"],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className="overflow-hidden" suppressHydrationWarning>
      <body
        className={`${bodyFont.className} ${logoFont.variable} overflow-hidden`}
      >
        <ThemeProvider>
          <NextIntlClientProvider messages={messages}>
            <AuthProvider>{children}</AuthProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
