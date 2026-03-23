/**
 * Invite email template builder.
 */

import { wrapEmailHtml, emailButton, emailGreeting } from "../emails/emailLayout";

export function buildInviteSubject(): string {
  return "You're invited to FiBuKI!";
}

export function buildInviteHtml(name?: string): string {
  let body = emailGreeting(name);

  body += `<p style="margin:0 0 16px;">An admin has granted you access to FiBuKI. You can now sign in and start managing your transactions, receipts, and tax documents with AI-powered matching.</p>`;

  body += emailButton("Sign in to FiBuKI", "https://fibuki.com/login");

  return wrapEmailHtml(body);
}

export function buildInviteText(name?: string): string {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi,";
  return [
    greeting,
    "",
    "An admin has granted you access to FiBuKI. You can now sign in and start managing your transactions, receipts, and tax documents with AI-powered matching.",
    "",
    "Sign in: https://fibuki.com/login",
  ].join("\n");
}
