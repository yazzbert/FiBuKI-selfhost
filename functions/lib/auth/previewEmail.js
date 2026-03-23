"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewEmailCallable = void 0;
const createCallable_1 = require("../utils/createCallable");
const digestEmail_1 = require("../digest/digestEmail");
const inviteEmail_1 = require("./inviteEmail");
const SAMPLE_USAGE_EUR = 4.5;
const SAMPLE_LIMIT_EUR = 5.0;
function buildBudgetWarningPreview(percent) {
    const usageEur = percent >= 100 ? SAMPLE_LIMIT_EUR : SAMPLE_USAGE_EUR;
    const limitEur = SAMPLE_LIMIT_EUR;
    const subject = percent >= 100
        ? "AI budget exhausted \u2014 auto-matching paused"
        : "You've used 90% of your AI budget";
    const text = percent >= 100
        ? `Hi,\n\nYou've used ${usageEur.toFixed(2)} EUR of your ${limitEur.toFixed(2)} EUR AI budget this period.\n\nAuto-matching has been paused to prevent unexpected charges. Your files will continue to be extracted, but AI-powered partner lookup and agentic matching are on hold.\n\nTo resume:\n- Add AI credits at https://fibuki.com/settings/billing\n- Or upgrade your plan for a higher budget\n\nBest,\nFiBuKI`
        : `Hi,\n\nYou've used ${usageEur.toFixed(2)} EUR of your ${limitEur.toFixed(2)} EUR AI budget this period (90%).\n\nOnce you reach 100%, auto-matching will be paused.\n\nTo avoid interruptions:\n- Add AI credits at https://fibuki.com/settings/billing\n- Set an overage cap to allow spending beyond your limit\n- Or upgrade your plan for a higher budget\n\nBest,\nFiBuKI`;
    const html = percent >= 100
        ? `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<p>Hi,</p>
<p>You've used <strong>${usageEur.toFixed(2)} EUR</strong> of your <strong>${limitEur.toFixed(2)} EUR</strong> AI budget this period.</p>
<p>Auto-matching has been <strong>paused</strong> to prevent unexpected charges. Your files will continue to be extracted, but AI-powered partner lookup and agentic matching are on hold.</p>
<p>To resume:</p>
<ul>
  <li><a href="https://fibuki.com/settings/billing">Add AI credits</a></li>
  <li>Or upgrade your plan for a higher budget</li>
</ul>
<p>Best,<br/>FiBuKI</p>
</div>
</body>
</html>`
        : `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<p>Hi,</p>
<p>You've used <strong>${usageEur.toFixed(2)} EUR</strong> of your <strong>${limitEur.toFixed(2)} EUR</strong> AI budget this period (<strong>90%</strong>).</p>
<p>Once you reach 100%, auto-matching will be paused.</p>
<p>To avoid interruptions:</p>
<ul>
  <li><a href="https://fibuki.com/settings/billing">Add AI credits</a></li>
  <li>Set an overage cap to allow spending beyond your limit</li>
  <li>Or upgrade your plan for a higher budget</li>
</ul>
<p>Best,<br/>FiBuKI</p>
</div>
</body>
</html>`;
    return { subject, html, text };
}
exports.previewEmailCallable = (0, createCallable_1.createCallable)({ name: "previewEmail" }, async (ctx, request) => {
    // Admin only
    if (!ctx.request.auth?.token.admin) {
        throw new createCallable_1.HttpsError("permission-denied", "Admin only");
    }
    const { template } = request;
    const validTemplates = [
        "digest",
        "budget_warning_90",
        "budget_warning_100",
        "invite",
    ];
    if (!validTemplates.includes(template)) {
        throw new createCallable_1.HttpsError("invalid-argument", `template must be one of: ${validTemplates.join(", ")}`);
    }
    switch (template) {
        case "digest": {
            const sampleStats = {
                newTransactions: 42,
                unmatchedTransactions: 7,
                completionRate: 83,
                newFiles: 12,
            };
            const unsubscribeUrl = "https://fibuki.com/api/digest/unsubscribe?token=sample";
            return {
                subject: (0, digestEmail_1.buildDigestSubject)(sampleStats),
                html: (0, digestEmail_1.buildDigestHtml)(sampleStats, unsubscribeUrl),
                text: (0, digestEmail_1.buildDigestText)(sampleStats, unsubscribeUrl),
            };
        }
        case "budget_warning_90":
            return buildBudgetWarningPreview(90);
        case "budget_warning_100":
            return buildBudgetWarningPreview(100);
        case "invite":
            return {
                subject: (0, inviteEmail_1.buildInviteSubject)(),
                html: (0, inviteEmail_1.buildInviteHtml)(),
                text: (0, inviteEmail_1.buildInviteText)(),
            };
        default:
            throw new createCallable_1.HttpsError("invalid-argument", "Unknown template");
    }
});
//# sourceMappingURL=previewEmail.js.map