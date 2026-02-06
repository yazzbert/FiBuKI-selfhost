import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Skeleton shimmer className="h-8 w-[140px] mb-2" />
          <Skeleton shimmer className="h-4 w-[220px]" />
        </div>
        <div className="flex gap-2">
          <Skeleton shimmer className="h-9 w-[100px]" />
          <Skeleton shimmer className="h-9 w-[100px]" />
        </div>
      </div>

      {/* Period selector skeleton */}
      <div className="flex items-center gap-4 mb-6">
        <Skeleton shimmer className="h-10 w-[180px]" />
        <Skeleton shimmer className="h-10 w-[120px]" />
        <Skeleton shimmer className="h-10 w-[100px]" />
      </div>

      {/* Timeline skeleton */}
      <div className="mb-8">
        <Skeleton shimmer className="h-20 w-full rounded-lg" />
      </div>

      {/* Main content cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Readiness card */}
        <div className="rounded-lg border bg-card p-6">
          <Skeleton shimmer className="h-6 w-[160px] mb-4" />
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton shimmer className="h-5 w-5 rounded-full" />
                <Skeleton shimmer className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>

        {/* Preview card */}
        <div className="rounded-lg border bg-card p-6">
          <Skeleton shimmer className="h-6 w-[120px] mb-4" />
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton shimmer className="h-4 w-[140px]" />
                <Skeleton shimmer className="h-4 w-[80px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
