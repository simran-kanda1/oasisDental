import { sectionToPath } from './routes';

export type AppSection =
  | 'dashboard'
  | 'appointments'
  | 'followups'
  | 'followUpOutreach'
  | 'frontDeskQueues'
  | 'inquiries'
  | 'estimates'
  | 'weave'
  | 'admin'
  | 'staffTasks'
  | 'settings';

export type NavigateSectionDetail = AppSection | { section: AppSection; queueId?: string };

const NAVIGATE_EVENT = 'oasis:navigate-section';

type RouterNavigate = (path: string) => void;

let routerNavigate: RouterNavigate | null = null;

/** Register react-router navigate from AppShell. */
export function registerAppNavigator(navigate: RouterNavigate) {
  routerNavigate = navigate;
}

export const navigateToSection = (section: AppSection, queueId?: string) => {
  const path = sectionToPath(section, queueId);
  routerNavigate?.(path);
  if (typeof window === 'undefined') return;
  const detail: NavigateSectionDetail = queueId ? { section, queueId } : section;
  window.dispatchEvent(new CustomEvent<NavigateSectionDetail>(NAVIGATE_EVENT, { detail }));
};

export function parseNavigateDetail(detail: NavigateSectionDetail | undefined): {
  section: AppSection | undefined;
  queueId?: string;
} {
  if (!detail) return { section: undefined };
  if (typeof detail === 'string') return { section: detail };
  return { section: detail.section, queueId: detail.queueId };
}

export const getNavigateEventName = () => NAVIGATE_EVENT;
