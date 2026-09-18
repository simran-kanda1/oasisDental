import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { StaffActor } from './activityLogger';

export type AuditEntityType = 'inquiry' | 'followUp' | 'task' | 'queueRow' | 'estimate';

export interface AuditLogEntry {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  field?: string;
  previousValue?: string;
  newValue?: string;
  userId: string;
  userEmail: string;
  userName: string;
  detail?: string;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      ...entry,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log failed:', err);
  }
}

export async function logStaffAudit(
  actor: StaffActor | null,
  entry: Omit<AuditLogEntry, 'userId' | 'userEmail' | 'userName'>
): Promise<void> {
  if (!actor) return;
  await logAudit({ ...entry, ...actor });
}

/** Human-readable summary of a queue-row tracking patch for activity/audit feeds. */
export function summarizeQueueTrackingPatch(patch: Record<string, unknown>): {
  action: string;
  field?: string;
  newValue?: string;
} {
  if (patch.notRebookedReason !== undefined) {
    const value = String(patch.notRebookedReason || '').trim() || 'cleared';
    return { action: `Why not rebooked → ${value}`, field: 'notRebookedReason', newValue: value };
  }
  if (patch.notes !== undefined) {
    return { action: 'Saved notes', field: 'notes' };
  }
  if (patch.treatmentComplete === true || patch.removedFromList === true) {
    return { action: 'Removed from list', field: 'removedFromList', newValue: 'true' };
  }
  if (patch.referredToSpecialist !== undefined) {
    return {
      action: `Referred to specialist → ${patch.referredToSpecialist ? 'yes' : 'no'}`,
      field: 'referredToSpecialist',
      newValue: String(!!patch.referredToSpecialist),
    };
  }
  if (patch.followUpAppointmentBooked !== undefined) {
    return {
      action: `Follow-up booked → ${patch.followUpAppointmentBooked ? 'yes' : 'no'}`,
      field: 'followUpAppointmentBooked',
      newValue: String(!!patch.followUpAppointmentBooked),
    };
  }
  if (patch.startTreatment !== undefined) {
    return {
      action: `Start treatment → ${patch.startTreatment ? 'yes' : 'no'}`,
      field: 'startTreatment',
      newValue: String(!!patch.startTreatment),
    };
  }
  if (patch.depositTaken !== undefined) {
    return {
      action: `Deposit taken → ${patch.depositTaken ? 'yes' : 'no'}`,
      field: 'depositTaken',
      newValue: String(!!patch.depositTaken),
    };
  }
  const keys = Object.keys(patch).filter((k) => !['updatedAt', 'updatedBy', 'appointmentId', 'patientId', 'queueId'].includes(k));
  return { action: keys.length ? `Updated ${keys.join(', ')}` : 'Updated tracking' };
}
