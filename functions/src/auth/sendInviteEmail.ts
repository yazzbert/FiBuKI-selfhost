/**
 * Send invite notification email via SendGrid.
 * Follows the same pattern as sendUsageWarning.ts.
 */

import { buildInviteSubject, buildInviteHtml, buildInviteText } from "./inviteEmail";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = "noreply@fibuki.com";
const FROM_NAME = "FiBuKI";

export async function sendInviteEmail(email: string): Promise<void> {
  if (!email) {
    console.warn("[InviteEmail] No email provided");
    return;
  }

  if (!SENDGRID_API_KEY) {
    console.warn("[InviteEmail] SENDGRID_API_KEY not configured, skipping email");
    return;
  }

  const sgMail = (await import("@sendgrid/mail")).default;
  sgMail.setApiKey(SENDGRID_API_KEY);

  await sgMail.send({
    to: email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: buildInviteSubject(),
    text: buildInviteText(),
    html: buildInviteHtml(),
  });

  console.log(`[InviteEmail] Sent invite to ${email}`);
}
