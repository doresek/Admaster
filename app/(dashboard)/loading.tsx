import { Skeleton } from '@/components/ui';

export default function DashboardLoading() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Recommendations strip skeleton */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>

      {/* 8-stat grid skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>

      {/* Activity row skeleton */}
      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <Skeleton className="md:col-span-2 h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>

      {/* Action cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
