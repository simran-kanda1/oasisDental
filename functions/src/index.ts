import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
setGlobalOptions({ maxInstances: 10, region: 'us-central1' });

const db = getFirestore();
const authAdmin = getAuth();

async function requireAdmin(uid: string): Promise<void> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists || snap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
}

const WIX_API_KEY = defineSecret('WIX_API_KEY');
/** Must match Firebase secret WIX_SITE_ID (Oasis Dental meta site id). */
const WIX_SITE_ID = defineSecret('WIX_SITE_ID');

export const DEFAULT_WIX_SITE_ID = '49642a86-09d4-465d-8a14-ccc3df507f41';

export type WixSyncMode = 'manual_week' | 'scheduled_incremental';

export interface WixSyncOptions {
  /** manual_week default 7; scheduled_incremental default 1 */
  sinceDays?: number;
  mode?: WixSyncMode;
}

const WIX_FORMS_NAMESPACE = 'wix.form_app.form';

type WixFieldValue = {
  stringValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  listValue?: { values?: WixFieldValue[] };
};

type WixFormSubmission = {
  id?: string;
  formId?: string;
  namespace?: string;
  status?: string;
  submissions?: Record<string, WixFieldValue>;
  createdDate?: string;
  contactId?: string;
};

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

export type WixInquiryUpsert = {
  docId: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  service: string;
  submittedAt: string;
  wixContactId?: string | null;
  wixSubmissionId?: string | null;
  wixSourceType?: string | null;
  wixFormId?: string | null;
};

function resolveSiteId(): string {
  const siteId = WIX_SITE_ID.value()?.trim();
  if (!siteId) throw new Error('WIX_SITE_ID secret missing');
  return siteId;
}

function sinceDateFromOptions(options?: WixSyncOptions): Date {
  const mode = options?.mode ?? 'manual_week';
  const days =
    options?.sinceDays ??
    (mode === 'scheduled_incremental' ? 1 : 7);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  return since;
}

function parseWixDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isOnOrAfter(value: string | undefined, since: Date): boolean {
  const d = parseWixDate(value);
  if (!d) return true;
  return d >= since;
}

function wixHeaders(): Record<string, string> {
  const key = WIX_API_KEY.value();
  const siteId = resolveSiteId();
  if (!key) throw new Error('WIX_API_KEY secret missing');
  if (!siteId) throw new Error('WIX_SITE_ID missing');
  return {
    Authorization: key,
    'wix-site-id': siteId,
    'Content-Type': 'application/json',
  };
}

function normalizePhoneDigits(phone: string | undefined | null): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

function phoneMatchKey(digits: string): string {
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function extractStringValue(val: WixFieldValue | undefined): string {
  if (!val) return '';
  if (typeof val.stringValue === 'string') return val.stringValue.trim();
  if (typeof val.numberValue === 'number') return String(val.numberValue);
  if (val.listValue?.values?.length) {
    return val.listValue.values.map((v) => extractStringValue(v)).filter(Boolean).join(', ');
  }
  return '';
}

function parseFormFields(fields: Record<string, WixFieldValue> | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!fields) return map;
  for (const [key, val] of Object.entries(fields)) {
    const s = extractStringValue(val);
    if (s) map[key.toLowerCase().replace(/\s+/g, '_')] = s;
  }
  return map;
}

function pickField(map: Record<string, string>, ...hints: string[]): string {
  for (const [k, v] of Object.entries(map)) {
    if (hints.some((h) => k.includes(h))) return v;
  }
  return '';
}

function parseFormSubmission(sub: WixFormSubmission): Omit<WixInquiryUpsert, 'docId'> | null {
  const id = String(sub.id ?? '').trim();
  if (!id) return null;
  const map = parseFormFields(sub.submissions);
  const first = pickField(map, 'first_name', 'firstname', 'first');
  const last = pickField(map, 'last_name', 'lastname', 'last');
  const full = pickField(map, 'full_name', 'name', 'your_name');
  const name = full || `${first} ${last}`.trim() || 'Unknown';
  const email = pickField(map, 'email', 'e_mail');
  const phone = pickField(map, 'phone', 'telephone', 'mobile', 'cell');
  const message =
    pickField(map, 'message', 'comment', 'comments', 'question', 'details', 'inquiry', 'notes') ||
    Object.entries(map)
      .filter(([k]) => !['email', 'phone', 'name', 'first', 'last'].some((h) => k.includes(h)))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
      .trim();

  return {
    name,
    email,
    phone,
    message,
    service: 'Website form',
    submittedAt: String(sub.createdDate ?? new Date().toISOString()),
    wixSubmissionId: id,
    wixContactId: sub.contactId ? String(sub.contactId) : null,
    wixSourceType: 'WIX_FORMS',
    wixFormId: sub.formId ? String(sub.formId) : null,
  };
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

async function wixFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...wixHeaders(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Wix API ${res.status} ${url}: ${txt.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

async function fetchWixFormSubmissions(since: Date): Promise<WixFormSubmission[]> {
  const all: WixFormSubmission[] = [];
  let cursor: string | undefined;
  const sinceIso = since.toISOString();

  for (let page = 0; page < 20; page++) {
    const body: Record<string, unknown> = {
      onlyYourOwn: false,
      query: {
        filter: {
          namespace: WIX_FORMS_NAMESPACE,
          createdDate: { $gte: sinceIso },
        },
        sort: [{ fieldName: 'createdDate', order: 'DESC' }],
        cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
      },
    };

    const json = await wixFetchJson<{
      submissions?: WixFormSubmission[];
      metadata?: { cursors?: { next?: string }; hasNext?: boolean };
    }>('https://www.wixapis.com/form-submission/v4/submissions/namespace/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const raw = json.submissions ?? [];
    for (const sub of raw) {
      if (isOnOrAfter(sub.createdDate, since)) all.push(sub);
    }
    const oldestRaw = raw[raw.length - 1];
    if (raw.length > 0 && oldestRaw && !isOnOrAfter(oldestRaw.createdDate, since)) break;
    const next = json.metadata?.cursors?.next;
    if (!next || !json.metadata?.hasNext) break;
    cursor = next;
  }

  return all;
}

async function fetchWixInquiryContacts(since: Date): Promise<WixContact[]> {
  const all: WixContact[] = [];
  let offset = 0;
  const limit = 100;
  const sinceIso = since.toISOString();

  for (let page = 0; page < 15; page++) {
    const json = await wixFetchJson<{ contacts?: WixContact[]; pagingMetadata?: { count?: number } }>(
      'https://www.wixapis.com/contacts/v4/contacts/query',
      {
        method: 'POST',
        body: JSON.stringify({
          query: {
            filter: { createdDate: { $gte: sinceIso } },
            paging: { limit, offset },
            sort: [{ fieldName: 'createdDate', order: 'DESC' }],
          },
        }),
      }
    );
    const raw = (json.contacts ?? []).filter(isLikelyWebsiteInquiryContact);
    for (const c of raw) {
      if (isOnOrAfter(c.createdDate, since)) all.push(c);
    }
    const oldestRaw = raw[raw.length - 1];
    if ((json.contacts?.length ?? 0) < limit || (oldestRaw && !isOnOrAfter(oldestRaw.createdDate, since))) break;
    offset += limit;
  }

  return all;
}

async function buildPatientPhoneSet(): Promise<Set<string>> {
  const snap = await db.collection('patients').get();
  const out = new Set<string>();
  snap.forEach((d) => {
    const row = d.data() as { home_phone?: string; mobile_phone?: string; status?: number };
    if (Number(row.status ?? 0) === 3 || Number(row.status ?? 0) === 4) return;
    const h = phoneMatchKey(normalizePhoneDigits(row.home_phone));
    const m = phoneMatchKey(normalizePhoneDigits(row.mobile_phone));
    if (h) out.add(h);
    if (m) out.add(m);
  });
  return out;
}

function contactToUpsert(c: WixContact): WixInquiryUpsert {
  const sourceType = String(c.source?.sourceType ?? '');
  return {
    docId: `contact-${c.id}`,
    name: pickName(c),
    email: pickEmail(c),
    phone: pickPhone(c),
    message: pickMessage(c),
    service: sourceType ? `Wix · ${sourceType}` : 'Website inquiry',
    submittedAt: String(c.createdDate ?? new Date().toISOString()),
    wixContactId: c.id,
    wixSubmissionId: null,
    wixSourceType: sourceType || null,
    wixFormId: null,
  };
}

export async function runWixInquirySync(options?: WixSyncOptions): Promise<{
  leads: number;
  formSubmissions: number;
  contacts: number;
  sinceIso: string;
  mode: WixSyncMode;
}> {
  const since = sinceDateFromOptions(options);
  const mode = options?.mode ?? 'manual_week';
  const sinceIso = since.toISOString();
  const patientPhones = await buildPatientPhoneSet();
  const nowIso = new Date().toISOString();
  const upserts: WixInquiryUpsert[] = [];
  const phoneKeysFromForms = new Set<string>();

  let formSubmissions = 0;
  try {
    const forms = await fetchWixFormSubmissions(since);
    for (const sub of forms) {
      const row = parseFormSubmission(sub);
      if (!row) continue;
      const phoneKey = phoneMatchKey(normalizePhoneDigits(row.phone));
      if (phoneKey) phoneKeysFromForms.add(phoneKey);
      upserts.push({ docId: `form-${row.wixSubmissionId}`, ...row });
      formSubmissions += 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('403') && !msg.includes('404')) {
      console.warn('Wix form submissions sync skipped:', msg);
    }
  }

  let contacts = 0;
  const wixContacts = await fetchWixInquiryContacts(since);
  for (const c of wixContacts) {
    const phoneKey = phoneMatchKey(normalizePhoneDigits(pickPhone(c)));
    if (phoneKey && phoneKeysFromForms.has(phoneKey)) continue;
    upserts.push(contactToUpsert(c));
    contacts += 1;
  }

  const BATCH_SIZE = 400;
  for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = upserts.slice(i, i + BATCH_SIZE);
    for (const row of chunk) {
      const phoneKey = phoneMatchKey(normalizePhoneDigits(row.phone));
      const phoneMatchExcluded = !!phoneKey && patientPhones.has(phoneKey);
      batch.set(
        db.collection('wixInquiries').doc(row.docId),
        {
          name: row.name,
          email: row.email,
          phone: row.phone,
          message: row.message,
          service: row.service,
          submittedAt: row.submittedAt,
          phoneMatchExcluded,
          wixContactId: row.wixContactId,
          wixSubmissionId: row.wixSubmissionId,
          wixSourceType: row.wixSourceType,
          wixFormId: row.wixFormId,
          lastWixSyncAt: nowIso,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  const existing = await db.collection('wixInquiries').get();
  const deleteBatch = db.batch();
  let deletes = 0;
  existing.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const missingWixId = !String(data.wixContactId ?? '').trim() && !String(data.wixSubmissionId ?? '').trim();
    const name = String(data.name ?? '').trim().toLowerCase();
    const phone = normalizePhoneDigits(String(data.phone ?? ''));
    const knownDummy =
      (name === 'ben carter' && phone.endsWith('9055552233')) ||
      (name === 'aisha malik' && phone.endsWith('9055551122'));
    if (missingWixId || knownDummy) {
      deleteBatch.delete(d.ref);
      deletes += 1;
    }
  });
  if (deletes > 0) await deleteBatch.commit();

  const byPhone = new Map<string, { id: string; submittedAt: string }[]>();
  const allInquiries = await db.collection('wixInquiries').get();
  allInquiries.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const phoneKey = phoneMatchKey(normalizePhoneDigits(String(data.phone ?? '')));
    if (!phoneKey) return;
    const list = byPhone.get(phoneKey) ?? [];
    list.push({ id: d.id, submittedAt: String(data.submittedAt ?? '') });
    byPhone.set(phoneKey, list);
  });

  const dupBatch = db.batch();
  let dupUpdates = 0;
  for (const list of byPhone.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const primaryId = sorted[0].id;
    for (let i = 1; i < sorted.length; i++) {
      dupBatch.set(
        db.collection('wixInquiries').doc(sorted[i].id),
        { duplicateOf: primaryId },
        { merge: true }
      );
      dupUpdates += 1;
    }
    dupBatch.set(db.collection('wixInquiries').doc(primaryId), { duplicateOf: null }, { merge: true });
  }
  if (dupUpdates > 0) await dupBatch.commit();

  return { leads: upserts.length, formSubmissions, contacts, sinceIso, mode };
}

function mapWixError(error: unknown): never {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('meta-site') && msg.includes('not found')) {
    throw new HttpsError(
      'failed-precondition',
      `WIX_SITE_ID does not match this API key. Set Firebase secret WIX_SITE_ID to your site id (${DEFAULT_WIX_SITE_ID}).`
    );
  }
  throw new HttpsError('internal', msg);
}

export const syncWixInquiries = onCall(
  { secrets: [WIX_API_KEY, WIX_SITE_ID] },
  async (request): Promise<{
    leads: number;
    formSubmissions: number;
    contacts: number;
    sinceIso: string;
    mode: WixSyncMode;
  }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    try {
      const lookbackDays = Number((request.data as { lookbackDays?: number } | undefined)?.lookbackDays ?? 7);
      return await runWixInquirySync({
        mode: 'manual_week',
        sinceDays: Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 7,
      });
    } catch (error) {
      mapWixError(error);
    }
  }
);

/** Check for new website inquiries every 5 minutes (last 24h window). */
/** Admin-only: create Firebase Auth user + Firestore profile with password. */
export const createStaffUser = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  await requireAdmin(request.auth.uid);

  const data = request.data as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: string;
  };
  const email = String(data.email ?? '').trim().toLowerCase();
  const password = String(data.password ?? '');
  const displayName = String(data.displayName ?? '').trim() || email.split('@')[0];
  const role = data.role === 'admin' ? 'admin' : 'staff';

  if (!email || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');
  }

  try {
    const userRecord = await authAdmin.createUser({ email, password, displayName });
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName,
      role,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.token.email ?? null,
    });
    return { uid: userRecord.uid, email, displayName, role };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('email-already-exists')) {
      throw new HttpsError('already-exists', 'An account with this email already exists.');
    }
    throw new HttpsError('internal', msg);
  }
});

export const syncWixInquiriesScheduled = onSchedule(
  {
    schedule: 'every 5 minutes',
    secrets: [WIX_API_KEY, WIX_SITE_ID],
    timeZone: 'America/Toronto',
  },
  async () => {
    try {
      const result = await runWixInquirySync({
        mode: 'scheduled_incremental',
        sinceDays: 1,
      });
      console.log('Wix inquiry sync (scheduled)', result);
    } catch (error) {
      console.error('Wix inquiry sync failed', error);
    }
  }
);
