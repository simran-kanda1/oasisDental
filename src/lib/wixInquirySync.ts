import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

interface SyncResult {
  leads: number;
}

/**
 * Production-safe sync: calls a Firebase Function where Wix secrets live.
 */
export async function syncWixInquiriesAndPhoneFlags(): Promise<{ leads: number; error?: string }> {
  try {
    const callable = httpsCallable<undefined, SyncResult>(functions, 'syncWixInquiries');
    const result = await callable();
    return { leads: Number(result.data?.leads ?? 0) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { leads: 0, error: msg };
  }
}
