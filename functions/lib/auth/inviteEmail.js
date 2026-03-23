"use strict";
/**
 * Invite email template builder.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInviteSubject = buildInviteSubject;
exports.buildInviteHtml = buildInviteHtml;
exports.buildInviteText = buildInviteText;
const emailLayout_1 = require("../emails/emailLayout");
function buildInviteSubject() {
    return "You're invited to FiBuKI!";
}
function buildInviteHtml(name) {
    let body = (0, emailLayout_1.emailGreeting)(name);
    body += `<p style="margin:0 0 16px;">An admin has granted you access to FiBuKI. You can now sign in and start managing your transactions, receipts, and tax documents with AI-powered matching.</p>`;
    body += (0, emailLayout_1.emailButton)("Sign in to FiBuKI", "https://fibuki.com/login");
    return (0, emailLayout_1.wrapEmailHtml)(body);
}
function buildInviteText(name) {
    const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi,";
    return [
        greeting,
        "",
        "An admin has granted you access to FiBuKI. You can now sign in and start managing your transactions, receipts, and tax documents with AI-powered matching.",
        "",
        "Sign in: https://fibuki.com/login",
    ].join("\n");
}
//# sourceMappingURL=inviteEmail.js.map