/**
 * Public route group layout.
 *
 * Used for unauthenticated, indexable-or-not pages such as shared invoices.
 * Intentionally minimal: no nav, no sidebar, no AuthProvider gating.
 * Overrides the root `overflow-hidden` so the page can scroll for printing.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-background flex flex-col overflow-y-auto">
      {children}
    </div>
  );
}
