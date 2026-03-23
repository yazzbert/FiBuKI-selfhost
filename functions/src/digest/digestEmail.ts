/**
 * HTML email template builder for weekly digest.
 */

import { wrapEmailHtml, emailButton, emailGreeting } from "../emails/emailLayout";

export interface DigestStats {
  newTransactions: number;
  unmatchedTransactions: number;
  completionRate: number;
  newFiles: number;
}

export function buildDigestSubject(stats: DigestStats): string {
  return `Your FiBuKI week: ${stats.newTransactions} new transaction${stats.newTransactions === 1 ? "" : "s"}`;
}

export function buildDigestHtml(
  stats: DigestStats,
  unsubscribeUrl: string,
  name?: string
): string {
  let body = emailGreeting(name);

  body += `<p style="margin:0 0 16px;">You had <strong>${stats.newTransactions} new transaction${stats.newTransactions === 1 ? "" : "s"}</strong> this week, <strong>${stats.completionRate}%</strong> matched with receipts.</p>`;

  if (stats.unmatchedTransactions > 0) {
    body += `<p style="margin:0 0 16px;"><strong>${stats.unmatchedTransactions} transaction${stats.unmatchedTransactions === 1 ? "" : "s"}</strong> still need${stats.unmatchedTransactions === 1 ? "s" : ""} receipts.</p>`;
  }

  if (stats.newFiles > 0) {
    body += `<p style="margin:0 0 16px;">${stats.newFiles} new file${stats.newFiles === 1 ? "" : "s"} uploaded.</p>`;
  }

  body += emailButton("Open FiBuKI", "https://fibuki.com/transactions");

  const footerHtml = `<p style="color:#9ca3af;font-size:12px;margin:0;">
    You're receiving this because you have a FiBuKI account.
    <br/>
    <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from weekly digests</a>
  </p>`;

  return wrapEmailHtml(body, { footerHtml });
}

export function buildDigestText(
  stats: DigestStats,
  unsubscribeUrl: string,
  name?: string
): string {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi,";
  const lines = [
    greeting,
    "",
    `You had ${stats.newTransactions} new transaction${stats.newTransactions === 1 ? "" : "s"} this week, ${stats.completionRate}% matched with receipts.`,
  ];

  if (stats.unmatchedTransactions > 0) {
    lines.push(`${stats.unmatchedTransactions} transaction${stats.unmatchedTransactions === 1 ? "" : "s"} still need${stats.unmatchedTransactions === 1 ? "s" : ""} receipts.`);
  }

  if (stats.newFiles > 0) {
    lines.push(`${stats.newFiles} new file${stats.newFiles === 1 ? "" : "s"} uploaded.`);
  }

  lines.push(
    "",
    "Open FiBuKI: https://fibuki.com/transactions",
    "",
    `Unsubscribe: ${unsubscribeUrl}`
  );

  return lines.join("\n");
}
