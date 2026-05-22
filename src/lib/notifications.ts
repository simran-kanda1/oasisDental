export type NotificationKind = 'task' | 'recall' | 'outreach' | 'inquiry';

export interface AppNotification {
  id: string;
  title: string;
  kind: NotificationKind;
  href: string;
}

const READ_KEY = 'oasis_read_notification_ids';

export function getReadNotificationIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markNotificationRead(id: string): void {
  const set = getReadNotificationIds();
  set.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...set]));
}

export function markAllNotificationsRead(ids: string[]): void {
  const set = getReadNotificationIds();
  ids.forEach((id) => set.add(id));
  localStorage.setItem(READ_KEY, JSON.stringify([...set]));
}

export function isNotificationRead(id: string): boolean {
  return getReadNotificationIds().has(id);
}
