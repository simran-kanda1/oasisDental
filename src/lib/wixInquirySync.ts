import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

interface SyncResult {
  leads: number;
  formSubmissions?: number;
  contacts?: number;
  sinceIso?: string;
  mode?: string;
}

/**
 * Production-safe sync: calls a Firebase Function where Wix secrets live.
 * @param lookbackDays — manual pull window (default 7 days).
 */
export async function syncWixInquiriesAndPhoneFlags(lookbackDays = 7): Promise<{
  leads: number;
  formSubmissions?: number;
  contacts?: number;
  sinceIso?: string;
  error?: string;
}> {
  try {
    const callable = httpsCallable<{ lookbackDays?: number }, SyncResult>(functions, 'syncWixInquiries');
    const result = await callable({ lookbackDays });
    return {
      leads: Number(result.data?.leads ?? 0),
      formSubmissions: result.data?.formSubmissions,
      contacts: result.data?.contacts,
      sinceIso: result.data?.sinceIso,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { leads: 0, error: msg };
  }
}
