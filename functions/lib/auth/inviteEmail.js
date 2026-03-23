"use strict";
/**
 * Invite email template builder.
 * Follows the same pattern as digestEmail.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInviteSubject = buildInviteSubject;
exports.buildInviteHtml = buildInviteHtml;
exports.buildInviteText = buildInviteText;
function buildInviteSubject() {
    return "You're invited to FiBuKI!";
}
function buildInviteHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to FiBuKI</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 4px;">FiBuKI</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Your AI accounting assistant</p>
    </div>

    <!-- Card -->
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
      <h2 style="font-size:18px;margin:0 0 12px;font-weight:600;">
        You&rsquo;re invited!
      </h2>

      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 16px;">
        An admin has granted you access to FiBuKI. You can now sign in and start managing your transactions, receipts, and tax documents with AI-powered matching.
      </p>

      <div style="text-align:center;margin-top:20px;">
        <a href="https://fibuki.com/login" style="display:inline-block;background:#18181b;color:#fff;padding:10px 28px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px;">
          Sign in to FiBuKI
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">
        You&rsquo;re receiving this because an admin invited you to FiBuKI.
      </p>
    </div>
  </div>
</body>
</html>`;
}
function buildInviteText() {
    return [
        "You're invited to FiBuKI!",
        "",
        "An admin has granted you access to FiBuKI. You can now sign in and start managing your transactions, receipts, and tax documents with AI-powered matching.",
        "",
        "Sign in: https://fibuki.com/login",
    ].join("\n");
}
//# sourceMappingURL=inviteEmail.js.map