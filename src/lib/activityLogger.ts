import { collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs, where, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

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
