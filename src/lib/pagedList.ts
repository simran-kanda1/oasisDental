/** Shared page-size for secretary list UIs. */
export const LIST_PAGE_SIZE = 40;

export function slicePage<T>(items: T[], page: number, pageSize = LIST_PAGE_SIZE): T[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function sliceInfinite<T>(items: T[], visibleCount: number): T[] {
  return items.slice(0, Math.max(0, visibleCount));
}

export function nextVisibleCount(current: number, total: number, pageSize = LIST_PAGE_SIZE): number {
  if (current >= total) return total;
  return Math.min(total, current + pageSize);
}
