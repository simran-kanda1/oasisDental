import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
setGlobalOptions({ maxInstances: 10, region: 'us-central1' });

const db = getFirestore();
const WIX_API_KEY = defineSecret('WIX_API_KEY');
const WIX_SITE_ID = defineSecret('WIX_SITE_ID');

type WixContact = {
  id: string;
  createdDate?: string;
  source?: { sourceType?: string };
  lastActivity?: { activityType?: string };
  primaryInfo?: { email?: string; phone?: string };
  info?: {
    name?: { first?: string; last?: string };
    phones?: { items?: Array<{ phone?: string; e164Phone?: string; primary?: boolean }> };
    emails?: { items?: Array<{ email?: string; primary?: boolean }> };
    extendedFields?: { items?: Record<string, unknown> };
  };
};

function normalizePhoneDigits(phone: string | undefined | null): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

function phoneMatchKey(digits: string): string {
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function isLikelyWebsiteInquiryContact(c: WixContact): boolean {
  const st = String(c.source?.sourceType ?? '');
  if (st === 'WIX_FORMS' || st === 'WIX_CHAT' || st === 'HOPP') return true;
  const at = String(c.lastActivity?.activityType ?? '');
  return at === 'FORM_SUBMITTED' || at === 'INBOX_FORM_SUBMITTED';
}

function pickPhone(c: WixContact): string {
  const primary = String(c.primaryInfo?.phone ?? '').trim();
  if (primary) return primary;
  const items = c.info?.phones?.items ?? [];
  const primaryItem = items.find((p) => p.primary);
  return String(primaryItem?.e164Phone ?? primaryItem?.phone ?? items[0]?.e164Phone ?? items[0]?.phone ?? '').trim();
}

function pickEmail(c: WixContact): string {
  const primary = String(c.primaryInfo?.email ?? '').trim();
  if (primary) return primary;
  const items = c.info?.emails?.items ?? [];
  const primaryItem = items.find((e) => e.primary);
  return String(primaryItem?.email ?? items[0]?.email ?? '').trim();
}

function pickName(c: WixContact): string {
  const f = String(c.info?.name?.first ?? '').trim();
  const l = String(c.info?.name?.last ?? '').trim();
  const full = `${f} ${l}`.trim();
  return full || 'Unknown';
}

function pickMessage(c: WixContact): string {
  const ext = c.info?.extendedFields?.items;
  if (!ext || typeof ext !== 'object') return '';
  const chunks: string[] = [];
  for (const [, value] of Object.entries(ext)) {
    if (value && typeof value === 'object' && 'stringValue' in value) {
      const v = (value as { stringValue?: unknown }).stringValue;
      if (typeof v === 'string' && v.trim()) chunks.push(v.trim());
    }
  }
  return chunks.join('\n').trim();
}

async function fetchWixContacts(): Promise<WixContact[]> {
  const key = WIX_API_KEY.value();
  const siteId = WIX_SITE_ID.value();
  if (!key || !siteId) throw new Error('WIX_API_KEY or WIX_SITE_ID secret missing');

  const params = new URLSearchParams();
  params.set('fieldsets', 'FULL');
  params.set('paging.limit', '150');
  params.set('sort.fieldName', 'createdDate');
  params.set('sort.order', 'DESC');

  const url = `https://www.wixapis.com/contacts/v4/contacts?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: key,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Wix API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = (await res.json()) as { contacts?: WixContact[] };
  return json.contacts ?? [];
}

async function buildPatientPhoneSet(): Promise<Set<string>> {
  const snap = await db.collection('patients').get();
  const out = new Set<string>();
  snap.forEach((d) => {
    const row = d.data() as { home_phone?: string; mobile_phone?: string };
    const h = phoneMatchKey(normalizePhoneDigits(row.home_phone));
    const m = phoneMatchKey(normalizePhoneDigits(row.mobile_phone));
    if (h) out.add(h);
    if (m) out.add(m);
  });
  return out;
}

export const syncWixInquiries = onCall(
  { secrets: [WIX_API_KEY, WIX_SITE_ID] },
  async (request): Promise<{ leads: number }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }

    let contacts: WixContact[] = [];
    try {
      contacts = await fetchWixContacts();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('meta-site') && msg.includes('not found')) {
        throw new HttpsError(
          'failed-precondition',
          'WIX_SITE_ID is not valid for this Wix API key. Set the real Wix Meta Site ID in Firebase Secret WIX_SITE_ID.'
        );
      }
      throw new HttpsError('internal', msg);
    }
    contacts = contacts.filter(isLikelyWebsiteInquiryContact);
    const patientPhones = await buildPatientPhoneSet();

    const batch = db.batch();
    const nowIso = new Date().toISOString();
    let leads = 0;

    for (const c of contacts) {
      const phone = pickPhone(c);
      const phoneKey = phoneMatchKey(normalizePhoneDigits(phone));
      const phoneMatchExcluded = !!phoneKey && patientPhones.has(phoneKey);
      const ref = db.collection('wixInquiries').doc(c.id);
      const sourceType = String(c.source?.sourceType ?? '');
      batch.set(
        ref,
        {
          wixContactId: c.id,
          name: pickName(c),
          email: pickEmail(c),
          phone,
          message: pickMessage(c),
          service: sourceType ? `Wix · ${sourceType}` : 'Website inquiry',
          submittedAt: String(c.createdDate ?? nowIso),
          phoneMatchExcluded,
          wixSourceType: sourceType || null,
          lastWixSyncAt: nowIso,
        },
        { merge: true }
      );
      leads += 1;
    }

    // Cleanup legacy dummy docs / non-Wix seeded rows.
    const existing = await db.collection('wixInquiries').get();
    existing.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const missingWixId = !String(data.wixContactId ?? '').trim();
      const name = String(data.name ?? '').trim().toLowerCase();
      const phone = normalizePhoneDigits(String(data.phone ?? ''));
      const knownDummy =
        (name === 'ben carter' && phone.endsWith('9055552233')) ||
        (name === 'aisha malik' && phone.endsWith('9055551122'));
      if (missingWixId || knownDummy) {
        batch.delete(d.ref);
      }
    });

    await batch.commit();
    return { leads };
  }
);
