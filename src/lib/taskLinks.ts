import type { AppSection } from './navigation';
import { NO_APPT_BOOKED_QUEUE_ID } from '../data/queueRules';
import { navigateToSection } from './navigation';

export interface TaskLinkTarget {
  section: AppSection;
  queueId?: string;
  label: string;
}

export interface TaskLinkConfig {
  presetId: string;
  targets: TaskLinkTarget[];
}

export interface TaskLinkFields {
  linkPresetId?: string;
  linkTargets?: TaskLinkTarget[];
  title?: string;
  taskId?: string;
}

export const TASK_LINK_PRESET_NONE = 'none';

export const TASK_LINK_PRESETS: TaskLinkConfig[] = [
  { presetId: TASK_LINK_PRESET_NONE, targets: [] },
  {
    presetId: 'no_appt_booked',
    targets: [
      {
        section: 'frontDeskQueues',
        queueId: NO_APPT_BOOKED_QUEUE_ID,
        label: 'No future appointments',
      },
    ],
  },
  {
    presetId: 'no_shows_past_week',
    targets: [
      {
        section: 'frontDeskQueues',
        queueId: 'no_shows_past_week',
        label: 'No shows (past week)',
      },
    ],
  },
  {
    presetId: 'uns_next_combo',
    targets: [
      {
        section: 'frontDeskQueues',
        queueId: NO_APPT_BOOKED_QUEUE_ID,
        label: 'No future appointments',
      },
      {
        section: 'frontDeskQueues',
        queueId: 'no_shows_past_week',
        label: 'No shows (past week)',
      },
    ],
  },
  {
    presetId: 'estimates',
    targets: [{ section: 'followUpOutreach', label: 'Estimate follow-up' }],
  },
  {
    presetId: 'inquiries',
    targets: [{ section: 'inquiries', label: 'Inquiries' }],
  },
  {
    presetId: 'appointments',
    targets: [{ section: 'appointments', label: "Today's schedule" }],
  },
  {
    presetId: 'dashboard',
    targets: [{ section: 'dashboard', label: 'Dashboard' }],
  },
  {
    presetId: 'hygiene_cc',
    targets: [{ section: 'frontDeskQueues', queueId: 'hygiene_cc', label: 'Hygiene CC' }],
  },
  {
    presetId: 'emerg_follow_up',
    targets: [{ section: 'frontDeskQueues', queueId: 'emerg_follow_up', label: 'Emerg patient follow up' }],
  },
  {
    presetId: 'new_patient_follow_up',
    targets: [
      { section: 'frontDeskQueues', queueId: 'new_patient_follow_up', label: 'New patient follow up' },
    ],
  },
  {
    presetId: 'fillings',
    targets: [{ section: 'frontDeskQueues', queueId: 'fillings', label: 'Fillings' }],
  },
];

const PRESET_BY_ID = new Map(TASK_LINK_PRESETS.map((p) => [p.presetId, p]));

export function getTaskLinkPreset(presetId: string | undefined): TaskLinkConfig | undefined {
  if (!presetId || presetId === TASK_LINK_PRESET_NONE) return PRESET_BY_ID.get(TASK_LINK_PRESET_NONE);
  return PRESET_BY_ID.get(presetId);
}

export function presetOptionsForSelect(): { id: string; label: string }[] {
  return TASK_LINK_PRESETS.map((p) => {
    if (p.presetId === TASK_LINK_PRESET_NONE) return { id: p.presetId, label: 'No link' };
    const labels = p.targets.map((t) => t.label).join(' + ');
    return { id: p.presetId, label: labels || p.presetId };
  });
}

/** Infer link for legacy schedule rows without linkPresetId in Firestore. */
export function inferTaskLinkPresetId(title: string): string {
  const t = title.trim().toLowerCase();
  if (!t) return TASK_LINK_PRESET_NONE;

  if (t.includes('inquir')) return 'inquiries';
  if (t.includes('predet') || t.includes('pre-d') || t.includes('pre det')) return 'estimates';
  if (t.includes('google review')) return TASK_LINK_PRESET_NONE;

  if (t.includes('unschedule') || t.includes('no show')) {
    if (t.includes('next day')) return 'uns_next_combo';
    if (t.includes('previous day')) return 'no_shows_past_week';
    return 'uns_next_combo';
  }

  if (t.includes('emergency') || t.includes('emerg ')) return 'emerg_follow_up';
  if (t.includes('hyg unbooked') || t.includes('hygiene')) return 'hygiene_cc';
  if (t.includes('new patient review') || t.includes('np/emerg')) return 'new_patient_follow_up';
  if (t.includes('treatment planner')) return 'fillings';

  return TASK_LINK_PRESET_NONE;
}

export function resolveTaskLinkConfig(fields: TaskLinkFields): TaskLinkConfig {
  if (fields.linkTargets?.length) {
    return {
      presetId: fields.linkPresetId ?? 'custom',
      targets: fields.linkTargets,
    };
  }
  const presetId =
    fields.linkPresetId && fields.linkPresetId !== TASK_LINK_PRESET_NONE
      ? fields.linkPresetId
      : inferTaskLinkPresetId(fields.title ?? '');
  const preset = getTaskLinkPreset(presetId);
  return preset ?? PRESET_BY_ID.get(TASK_LINK_PRESET_NONE)!;
}

export function taskHasNavigableLink(fields: TaskLinkFields): boolean {
  return resolveTaskLinkConfig(fields).targets.length > 0;
}

export function applyTaskLinkTarget(target: TaskLinkTarget): void {
  navigateToSection(target.section, target.queueId);
}

export function applyTaskLinkConfig(config: TaskLinkConfig): boolean {
  if (!config.targets.length) return false;
  if (config.targets.length === 1) {
    applyTaskLinkTarget(config.targets[0]);
    return true;
  }
  return false;
}

export function linkTargetsForFirestore(presetId: string): {
  linkPresetId: string;
  linkTargets: TaskLinkTarget[] | null;
} {
  const preset = getTaskLinkPreset(presetId);
  const targets = preset?.targets ?? [];
  return {
    linkPresetId: presetId,
    linkTargets: targets.length ? targets : null,
  };
}
