/**
 * Selfhost drop-in for `src/utils/mailer` (aliased by path suffix in
 * vitest.selfhost.config.ts): same sendEmail()/isMailerConfigured()
 * surface, but delivery goes over SMTP (Migadu) instead of Resend.
 *
 * Env:
 *   FIBUKI_SMTP_HOST     e.g. "smtp.migadu.com" (required)
 *   FIBUKI_SMTP_PORT     default 465
 *   FIBUKI_SMTP_SECURE   "false" to disable implicit TLS (default on for 465)
 *   FIBUKI_SMTP_USER     auth mailbox (required)
 *   FIBUKI_SMTP_PASS     (required)
 *   FIBUKI_SMTP_FROM_NAME  display name, default "FiBuKI"
 *
 * The From/envelope address is always FIBUKI_SMTP_USER — Migadu rejects
 * mail whose envelope-from doesn't match the authenticated mailbox, so the
 * shim aligns them by construction instead of offering a separate from env.
 */

import type { Transporter } from "nodemailer";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export function isMailerConfigured(): boolean {
  return Boolean(
    process.env.FIBUKI_SMTP_HOST &&
      process.env.FIBUKI_SMTP_USER &&
      process.env.FIBUKI_SMTP_PASS,
  );
}

let transporter: Transporter | undefined;

/** Test hook: inject a fake transport (and count as configured). */
export function _setTransportForTests(t: Transporter | undefined): void {
  transporter = t;
}

async function getTransport(): Promise<Transporter> {
  if (!transporter) {
    const nodemailer = await import("nodemailer");
    const port = parseInt(process.env.FIBUKI_SMTP_PORT || "465", 10);
    transporter = nodemailer.createTransport({
      host: process.env.FIBUKI_SMTP_HOST,
      port,
      secure: process.env.FIBUKI_SMTP_SECURE !== "false" && port === 465,
      auth: {
        user: process.env.FIBUKI_SMTP_USER,
        pass: process.env.FIBUKI_SMTP_PASS,
      },
    });
  }
  return transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (!transporter && !isMailerConfigured()) {
    console.warn(
      `[Mailer:selfhost] SMTP not configured (FIBUKI_SMTP_HOST/USER/PASS), ` +
        `skipping email "${options.subject}"`,
    );
    return false;
  }

  const user = process.env.FIBUKI_SMTP_USER || "selfhost@invalid";
  const fromName = process.env.FIBUKI_SMTP_FROM_NAME || "FiBuKI";
  const transport = await getTransport();

  await transport.sendMail({
    from: `${fromName} <${user}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    ...(options.headers ? { headers: options.headers } : {}),
  });

  return true;
}
