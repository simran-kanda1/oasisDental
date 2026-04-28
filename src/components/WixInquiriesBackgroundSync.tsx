import { useEffect, useRef } from 'react';
import { syncWixInquiriesAndPhoneFlags } from '../lib/wixInquirySync';

const POLL_MS = 120_000;

/**
 * Keeps `wixInquiries` aligned with Wix CRM and patient phone exclusions.
 * Server-side only: API keys live in Firebase Functions env/secrets.
 */
export const WixInquiriesBackgroundSync = () => {
  const busy = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        await syncWixInquiriesAndPhoneFlags();
      } catch {
        // Keep UI resilient; manual pull still available.
      } finally {
        busy.current = false;
      }
    };

    void run();
    const id = window.setInterval(() => void run(), POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  return null;
};
