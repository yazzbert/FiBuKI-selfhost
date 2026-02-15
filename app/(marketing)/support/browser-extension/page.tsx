import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { LanguageToggle } from "@/components/landing/language-toggle";
import { LandingFooter } from "@/components/landing/footer";

const EXTENSION_ID = "oggcmcaebeapfancgdhnpjhemllpjpbl";

export default async function BrowserExtensionSupportPage() {
  const common = await getTranslations("common");

  return (
    <>
      <main className="flex-1 py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {common("back")}
            </Link>
            <LanguageToggle />
          </div>

          <h1 className="text-3xl font-bold mb-2">FiBuKI Browser Plugin Support</h1>
          <p className="text-muted-foreground mb-8">
            Support information for the FiBuKI browser extension.
          </p>

          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-semibold mb-3">Contact</h2>
              <p className="text-muted-foreground">
                Email:{" "}
                <a className="underline hover:no-underline" href="mailto:hello@fibuki.com">
                  hello@fibuki.com
                </a>
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">Before You Contact Support</h2>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>Open FiBuKI and ensure you are logged in to your account.</li>
                <li>Open `chrome://extensions`, locate the plugin, and click Reload.</li>
                <li>Retry the invoice pull from Integrations → Browser in FiBuKI.</li>
                <li>Confirm the target website is reachable and your portal session is valid.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">Helpful Details to Include</h2>
              <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                <li>What you clicked and what happened instead.</li>
                <li>Approximate timestamp and timezone.</li>
                <li>Browser version and operating system.</li>
                <li>Extension ID: {EXTENSION_ID}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">Legal</h2>
              <div className="flex flex-col gap-2 text-muted-foreground">
                <Link href="/privacy" className="inline-flex items-center gap-2 hover:underline">
                  Privacy Policy <ExternalLink className="h-4 w-4" />
                </Link>
                <Link href="/terms" className="inline-flex items-center gap-2 hover:underline">
                  Terms of Service <ExternalLink className="h-4 w-4" />
                </Link>
                <Link href="/impressum" className="inline-flex items-center gap-2 hover:underline">
                  Imprint / Legal Notice <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </main>

      <LandingFooter />
    </>
  );
}
