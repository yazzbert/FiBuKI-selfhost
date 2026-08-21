/**
 * Shared mail-ingestion constants.
 *
 * These define what "an invoice-type attachment" means and how big a search
 * batch is. They are provider-neutral: Gmail builds them into a query string,
 * IMAP applies the mimetype filter against BODYSTRUCTURE. Keeping them in one
 * place stops the two providers from drifting.
 */

/** Max messages fetched per search page (both providers paginate to this). */
export const MAX_EMAILS_PER_BATCH = 50;

/** Invoice/receipt keywords (German + English) used to narrow a search. */
export const INVOICE_KEYWORDS = [
  // German
  "Rechnung",
  "Beleg",
  "Quittung",
  "Faktura",
  "Zahlungsbeleg",
  "Kaufbeleg",
  "Zahlungsbestätigung",
  // English
  "Invoice",
  "Receipt",
  "Bill",
  "Payment confirmation",
  "Order confirmation",
];

/** MIME types we treat as invoice attachments. */
export const INVOICE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Trailing window a manual "Pull New Files" press syncs, in days.
 *
 * Three rather than seven because attachment de-duplication happens by content
 * hash *after* download, so a wider window re-downloads every attachment on
 * every press — and the button's real job is "mail arrived in the last few
 * hours". Re-scanning is otherwise safe: the sync worker only ever expands an
 * integration's synced range, never contracts it.
 */
export const MANUAL_SYNC_WINDOW_DAYS = 3;
