import type { AppSection } from './navigation';
import { NO_APPT_BOOKED_QUEUE_ID } from '../data/queueRules';

export function sectionToPath(section: AppSection, queueId?: string): string {
  switch (section) {
    case 'dashboard':
      return '/dashboard';
    case 'staffTasks':
      return '/checklist';
    case 'appointments':
      return '/appointments';
    case 'frontDeskQueues':
    case 'followups':
      return queueId ? `/queues/${encodeURIComponent(queueId)}` : `/queues/${NO_APPT_BOOKED_QUEUE_ID}`;
    case 'followUpOutreach':
      return '/estimates';
    case 'estimates':
      return '/estimates';
    case 'inquiries':
      return '/inquiries';
    case 'admin':
      return '/admin';
    case 'settings':
      return '/settings';
    case 'weave':
      return '/weave';
    default:
      return '/dashboard';
  }
}

export function pathToSection(pathname: string): { section: AppSection; queueId?: string } {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/dashboard') return { section: 'dashboard' };
  if (path === '/checklist') return { section: 'staffTasks' };
  if (path === '/appointments') return { section: 'appointments' };
  if (path.startsWith('/queues/')) {
    const queueId = decodeURIComponent(path.slice('/queues/'.length));
    return { section: 'frontDeskQueues', queueId: queueId || NO_APPT_BOOKED_QUEUE_ID };
  }
  if (path === '/queues' || path === '/followups') {
    return { section: 'frontDeskQueues', queueId: NO_APPT_BOOKED_QUEUE_ID };
  }
  if (path === '/estimates' || path === '/follow-up') return { section: 'followUpOutreach' };
  if (path === '/inquiries') return { section: 'inquiries' };
  if (path === '/admin') return { section: 'admin' };
  if (path === '/settings') return { section: 'settings' };
  if (path === '/weave') return { section: 'weave' };
  return { section: 'dashboard' };
}

export const DEFAULT_AUTHENTICATED_PATH = '/dashboard';
export const DEFAULT_STAFF_PATH = '/checklist';
