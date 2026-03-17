import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { EXPANDABLE_COUNTRIES } from "@/types/expand";
import { CountryPageContent } from "@/components/expand/country-page-content";

interface Props {
  params: Promise<{ country: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country: slug } = await params;
  const code = slug.toUpperCase();
  const country = EXPANDABLE_COUNTRIES.find((c) => c.code === code);

  if (!country) return {};

  const title = `Help unlock PSD2 banking in ${country.name}`;
  const description = `Back FiBuKI in ${country.name} with €10 to help activate direct bank connections via PSD2. Your payment becomes credit toward your first month.`;

  return {
    title,
    description,
    openGraph: {
      title: `${country.flag} ${title}`,
      description,
      url: `https://fibuki.com/expand/${slug}`,
      siteName: "FiBuKI",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${country.flag} ${title}`,
      description,
    },
  };
}

export function generateStaticParams() {
  return EXPANDABLE_COUNTRIES.map((c) => ({
    country: c.code.toLowerCase(),
  }));
}

export default async function CountryExpandPage({ params }: Props) {
  const { country: slug } = await params;
  const code = slug.toUpperCase();
  const country = EXPANDABLE_COUNTRIES.find((c) => c.code === code);

  if (!country) notFound();

  return (
    <Suspense>
      <CountryPageContent countryCode={code} />
    </Suspense>
  );
}
