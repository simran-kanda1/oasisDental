export type AppSection =
  | 'dashboard'
  | 'appointments'
  | 'followups'
  | 'followUpOutreach'
  | 'frontDeskQueues'
  | 'inquiries'
  | 'estimates'
  | 'newsletter'
  | 'weave'
  | 'admin'
  | 'staffTasks';

const NAVIGATE_EVENT = 'oasis:navigate-section';

export const navigateToSection = (section: AppSection) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppSection>(NAVIGATE_EVENT, { detail: section }));
};

export const getNavigateEventName = () => NAVIGATE_EVENT;
