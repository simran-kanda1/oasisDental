import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type AuditEntityType = 'inquiry' | 'followUp' | 'task';

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
