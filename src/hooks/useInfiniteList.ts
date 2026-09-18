import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIST_PAGE_SIZE, nextVisibleCount, sliceInfinite } from '../lib/pagedList';

/**
 * Client-side infinite list: accurate total from full filtered array,
 * render first `pageSize` then load more on sentinel intersection.
 */
export function useInfiniteList<T>(items: T[], pageSize = LIST_PAGE_SIZE, resetKey?: string) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [pageSize, resetKey, items.length]);

  const total = items.length;
  const visibleItems = useMemo(() => sliceInfinite(items, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < total;

  const loadMore = useCallback(() => {
    setVisibleCount((n) => nextVisibleCount(n, total, pageSize));
  }, [pageSize, total]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: '240px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore, visibleItems.length]);

  return {
    total,
    visibleItems,
    visibleCount,
    hasMore,
    loadMore,
    sentinelRef,
    pageSize,
  };
}
