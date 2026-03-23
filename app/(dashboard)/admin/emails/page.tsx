"use client";

import { useState } from "react";
import { Loader2, Mail, AlertTriangle, CreditCard, UserPlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProtectedRoute } from "@/components/auth";
import { callFunction } from "@/lib/firebase/callable";

type EmailTemplate = "digest" | "budget_warning_90" | "budget_warning_100" | "invite";

interface PreviewData {
  subject: string;
  html: string;
  text: string;
}

const TEMPLATES: {
  id: EmailTemplate;
  label: string;
  description: string;
  icon: typeof Mail;
}[] = [
  {
    id: "digest",
    label: "Weekly Digest",
    description: "Sent weekly with transaction stats",
    icon: FileText,
  },
  {
    id: "budget_warning_90",
    label: "Budget 90%",
    description: "AI budget approaching limit",
    icon: AlertTriangle,
  },
  {
    id: "budget_warning_100",
    label: "Budget 100%",
    description: "AI budget exhausted",
    icon: CreditCard,
  },
  {
    id: "invite",
    label: "Invite",
    description: "Sent when a user is invited",
    icon: UserPlus,
  },
];

export default function AdminEmailsPage() {
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSelect = async (template: EmailTemplate) => {
    setSelected(template);
    setError("");
    setLoading(true);

    try {
      const result = await callFunction<
        { template: EmailTemplate },
        PreviewData
      >("previewEmail", { template });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preview");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute requireAdmin>
      <div className="h-full overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">Email Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Preview all outbound email templates with sample data
            </p>
          </div>

          {/* Template selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                className={`
                  flex flex-col items-center gap-2 p-4 rounded-lg border text-center transition-colors
                  ${selected === t.id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }
                `}
              >
                <t.icon className="h-5 w-5" />
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </button>
            ))}
          </div>

          {/* Preview area */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <Card>
              <CardContent className="py-6 text-center text-destructive">
                {error}
              </CardContent>
            </Card>
          )}

          {!loading && preview && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  From: noreply@fibuki.com
                </div>
                <CardTitle className="text-lg">{preview.subject}</CardTitle>
                <CardDescription>
                  Template: {TEMPLATES.find((t) => t.id === selected)?.label}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="html">
                  <TabsList>
                    <TabsTrigger value="html">HTML</TabsTrigger>
                    <TabsTrigger value="text">Plain Text</TabsTrigger>
                  </TabsList>
                  <TabsContent value="html" className="mt-3">
                    <div className="border rounded-lg overflow-hidden bg-white">
                      <iframe
                        srcDoc={preview.html}
                        className="w-full min-h-[500px] border-0"
                        title="Email preview"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="text" className="mt-3">
                    <pre className="p-4 border rounded-lg bg-muted/50 text-sm whitespace-pre-wrap font-mono">
                      {preview.text}
                    </pre>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {!loading && !preview && !error && (
            <div className="text-center py-12 text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>Select a template to preview</p>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
