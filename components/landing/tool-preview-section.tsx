"use client";

import { useTranslations } from "next-intl";
import { ToolPreviewCard } from "./tool-preview-card";
import { Landmark, Sparkles, Terminal } from "lucide-react";
import Image from "next/image";

const FLOATING_LOGOS = [
  {
    src: "/logos/claude.svg",
    alt: "Claude",
    className: "absolute -top-4 -right-4 animate-float-slow",
  },
  {
    src: "/logos/chatgpt.svg",
    alt: "ChatGPT",
    className: "absolute -bottom-3 -left-4 animate-float-medium",
  },
  {
    src: "/logos/openclaw.svg",
    alt: "OpenClaw",
    className: "absolute top-1/2 -right-5 -translate-y-1/2 animate-float-fast",
  },
];

export function ToolPreviewSection() {
  const t = useTranslations("landing.toolPreviews");

  return (
    <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full px-4">
      {/* Live Bank Data */}
      <div className="space-y-3 animate-float-slow">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Landmark className="h-4 w-4" />
          <span>{t("transactions.title")}</span>
        </div>
        <ToolPreviewCard type="transactions" />
      </div>

      {/* AI-First Matching */}
      <div className="space-y-3 animate-float-medium">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span>{t("files.title")}</span>
        </div>
        <ToolPreviewCard type="files" />
      </div>

      {/* MCP & API */}
      <div className="space-y-3 animate-float-fast">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Terminal className="h-4 w-4" />
          <span>{t("integrations.title")}</span>
        </div>
        <div className="relative">
          <ToolPreviewCard type="api" />
          {FLOATING_LOGOS.map((logo) => (
            <div key={logo.alt} className={logo.className}>
              <Image
                src={logo.src}
                alt={logo.alt}
                width={36}
                height={36}
                className="rounded-lg shadow-md"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
