export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-full animate-in fade-in-0 slide-in-from-bottom-1 duration-200 fill-mode-both">
      {children}
    </div>
  );
}
