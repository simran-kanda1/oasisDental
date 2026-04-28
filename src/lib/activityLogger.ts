import { collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs, where, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/** Use with `detail` JSON for dashboard KPIs. */
export const ACTIVITY_SECTION_RECALL_QUEUE = 'recallQueue';
export const ACTIVITY_SECTION_FOLLOW_UP_OUTREACH = 'followUpOutreach';

export interface ActivityLog {
    id?: string;
    userId: string;
    userEmail: string;
    userName: string;
    action: string;
    section: string;
    detail?: string;
    timestamp?: Timestamp;
}

export function buildOutreachActivityDetail(payload: {
    channel: string;
    reached: string;
    outcome: string;
    notes?: string;
    callbackDate?: string;
    patientId?: string;
    queue: 'recall' | 'outreach';
}): string {
    return JSON.stringify({ type: 'outreach', ...payload });
}

export async function logActivity(log: Omit<ActivityLog, 'id' | 'timestamp'>) {
    try {
        await addDoc(collection(db, 'activityLogs'), {
            ...log,
            timestamp: serverTimestamp(),
        });
    } catch (err) {
        // Silently fail — logging should never break the UI
        console.warn('Activity log failed:', err);
    }
}

export async function getRecentActivity(limitCount = 50): Promise<ActivityLog[]> {
    const q = query(
        collection(db, 'activityLogs'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog));
}

export async function getActivityByUser(userId: string, limitCount = 50): Promise<ActivityLog[]> {
    const q = query(
        collection(db, 'activityLogs'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog));
}
