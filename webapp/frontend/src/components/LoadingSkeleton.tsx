interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/12 ${className}`}
      aria-hidden="true"
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="glass-panel rounded-[26px] p-4">
      <div className="mb-3 flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="mb-3 h-2 w-full rounded-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <tr className="border-t border-white/10">
      <td className="px-3 py-2"><Skeleton className="h-3 w-24" /></td>
      <td className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>
      <td className="px-3 py-2"><Skeleton className="h-3 w-12" /></td>
      <td className="px-3 py-2"><Skeleton className="h-3 w-8" /></td>
    </tr>
  );
}

export function ListItemSkeleton() {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/8 p-3">
      <Skeleton className="mb-1 h-4 w-32" />
      <Skeleton className="mb-1 h-3 w-20" />
      <Skeleton className="h-3 w-48" />
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="glass-panel rounded-[26px] p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div>
          <Skeleton className="mb-1 h-4 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mt-3 h-2 w-full rounded-full" />
    </div>
  );
}
