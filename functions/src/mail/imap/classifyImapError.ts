/**
 * IMAP failure classifier.
 *
 * Reduces whatever imapflow threw to one of five plain-language outcomes, so a
 * user can tell a revoked app-password (re-enter credentials) from a mail
 * server that was down for ten minutes (press the button again) — two problems
 * that need opposite responses.
 *
 * Lives here rather than in the connect route because both moments an IMAP
 * mailbox can fail — connect-time verification and the sync worker — have to
 * speak with one voice. Direction of the dependency matters: the app layer
 * imports from functions/, never the reverse, because functions/ builds
 * standalone for deploy.
 */

/** The five outcomes a failed IMAP connection is reduced to. */
export type ImapErrorCode =
  | "auth_failed"
  | "tls_failed"
  | "unreachable"
  | "mailbox_not_found"
  | "connect_failed";

/** A classified failure: a stable code plus the copy shown to the user. */
export interface ImapErrorClassification {
  code: ImapErrorCode;
  message: string;
}

/**
 * Classify an imapflow connection failure so the UI can be specific about
 * whether the host, the TLS cert, or the credentials are wrong.
 */
export function classifyImapError(error: unknown): ImapErrorClassification {
  // imapflow reports a server NO/BAD as the bare message "Command failed" and
  // puts the useful part on the error object (responseText, serverResponseCode,
  // mailboxMissing). Fold those in so the regexes below see the real reason and
  // the fallback surfaces the server's own words instead of "Command failed".
  const e = (error ?? {}) as {
    responseText?: string;
    serverResponseCode?: string;
    mailboxMissing?: boolean;
    authenticationFailed?: boolean;
  };
  const base = error instanceof Error ? error.message : String(error);
  const msg = [base, e.serverResponseCode, e.responseText].filter(Boolean).join(" ");
  const authCode = e.authenticationFailed;
  if (e.mailboxMissing) {
    const detail = e.responseText ? ` (${e.responseText})` : "";
    return {
      code: "mailbox_not_found",
      message: `Mailbox not found on the server${detail}. Use the folder name, e.g. INBOX, not the email address.`,
    };
  }
  if (authCode || /AUTHENTICATIONFAILED|invalid credentials|auth/i.test(msg)) {
    return { code: "auth_failed", message: "Authentication failed. Check the username and app-password." };
  }
  if (/self.signed|certificate|SSL|TLS|DEPTH_ZERO/i.test(msg)) {
    return { code: "tls_failed", message: "TLS/certificate error. For an internal server, enable 'allow self-signed'." };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|getaddrinfo/i.test(msg)) {
    return { code: "unreachable", message: "Could not reach the mail server. Check host and port." };
  }
  if (/Mailbox|NONEXISTENT|does not exist/i.test(msg)) {
    return { code: "mailbox_not_found", message: "Mailbox not found on the server." };
  }
  return { code: "connect_failed", message: msg };
}
