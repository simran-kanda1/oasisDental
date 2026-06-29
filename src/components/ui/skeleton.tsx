import { cn } from '../../lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/80', className)} />;
}

export function PageHeaderSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-md p-4 flex items-center gap-4">
      <Skeleton className="w-10 h-10 rounded" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 p-4 rounded-md flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-2 w-24" />
            <Skeleton className="h-7 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-hidden divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-3">
          <Skeleton className="w-4 h-4 rounded shrink-0" />
          <Skeleton className="h-4 flex-1 max-w-md" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}

export function AppSpinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-9 w-9 rounded-full border-2 border-slate-200 border-t-teal-600 animate-spin',
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function AppLoadingSkeleton() {
  return (
    <div className="min-h-screen min-h-[100dvh] w-full bg-slate-50 flex items-center justify-center p-6">
      <div className="flex flex-col items-center justify-center gap-5 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-white text-xl font-black shadow-sm">
          O
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-800 uppercase tracking-widest">Oasis Dental</p>
          <p className="text-xs text-slate-500">Loading your workspace…</p>
        </div>
        <AppSpinner />
      </div>
    </div>
  );
}

export function PageLoadingFallback() {
  return (
    <div className="flex min-h-[min(60vh,32rem)] w-full items-center justify-center p-8">
      <AppSpinner />
    </div>
  );
}
