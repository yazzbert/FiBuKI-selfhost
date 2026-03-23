"use strict";
/**
 * HTML email template builder for weekly digest.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDigestSubject = buildDigestSubject;
exports.buildDigestHtml = buildDigestHtml;
exports.buildDigestText = buildDigestText;
const emailLayout_1 = require("../emails/emailLayout");
function buildDigestSubject(stats) {
    return `Your FiBuKI week: ${stats.newTransactions} new transaction${stats.newTransactions === 1 ? "" : "s"}`;
}
function buildDigestHtml(stats, unsubscribeUrl, name) {
    let body = (0, emailLayout_1.emailGreeting)(name);
    body += `<p style="margin:0 0 16px;">You had <strong>${stats.newTransactions} new transaction${stats.newTransactions === 1 ? "" : "s"}</strong> this week, <strong>${stats.completionRate}%</strong> matched with receipts.</p>`;
    if (stats.unmatchedTransactions > 0) {
        body += `<p style="margin:0 0 16px;"><strong>${stats.unmatchedTransactions} transaction${stats.unmatchedTransactions === 1 ? "" : "s"}</strong> still need${stats.unmatchedTransactions === 1 ? "s" : ""} receipts.</p>`;
    }
    if (stats.newFiles > 0) {
        body += `<p style="margin:0 0 16px;">${stats.newFiles} new file${stats.newFiles === 1 ? "" : "s"} uploaded.</p>`;
    }
    body += (0, emailLayout_1.emailButton)("Open FiBuKI", "https://fibuki.com/transactions");
    const footerHtml = `<p style="color:#9ca3af;font-size:12px;margin:0;">
    You're receiving this because you have a FiBuKI account.
    <br/>
    <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from weekly digests</a>
  </p>`;
    return (0, emailLayout_1.wrapEmailHtml)(body, { footerHtml });
}
function buildDigestText(stats, unsubscribeUrl, name) {
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
    lines.push("", "Open FiBuKI: https://fibuki.com/transactions", "", `Unsubscribe: ${unsubscribeUrl}`);
    return lines.join("\n");
}
//# sourceMappingURL=digestEmail.js.map