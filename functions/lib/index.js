"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncWixInquiriesScheduled = exports.createStaffUser = exports.syncWixInquiries = exports.DEFAULT_WIX_SITE_ID = void 0;
exports.runWixInquirySync = runWixInquirySync;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
(0, app_1.initializeApp)();
(0, v2_1.setGlobalOptions)({ maxInstances: 10, region: 'us-central1' });
const db = (0, firestore_1.getFirestore)();
const authAdmin = (0, auth_1.getAuth)();
async function requireAdmin(uid) {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists || snap.data()?.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Admin access required.');
    }
}
const WIX_API_KEY = (0, params_1.defineSecret)('WIX_API_KEY');
/** Must match Firebase secret WIX_SITE_ID (Oasis Dental meta site id). */
const WIX_SITE_ID = (0, params_1.defineSecret)('WIX_SITE_ID');
exports.DEFAULT_WIX_SITE_ID = '49642a86-09d4-465d-8a14-ccc3df507f41';
const WIX_FORMS_NAMESPACE = 'wix.form_app.form';
function resolveSiteId() {
    const siteId = WIX_SITE_ID.value()?.trim();
    if (!siteId)
        throw new Error('WIX_SITE_ID secret missing');
    return siteId;
}
function sinceDateFromOptions(options) {
    const mode = options?.mode ?? 'manual_week';
    const days = options?.sinceDays ??
        (mode === 'scheduled_incremental' ? 1 : 7);
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    return since;
}
function parseWixDate(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
function isOnOrAfter(value, since) {
    const d = parseWixDate(value);
    if (!d)
        return true;
    return d >= since;
}
function wixHeaders() {
    const key = WIX_API_KEY.value();
    const siteId = resolveSiteId();
    if (!key)
        throw new Error('WIX_API_KEY secret missing');
    if (!siteId)
        throw new Error('WIX_SITE_ID missing');
    return {
        Authorization: key,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
    };
}
function normalizePhoneDigits(phone) {
    if (!phone)
        return '';
    return String(phone).replace(/\D/g, '');
}
function phoneMatchKey(digits) {
    return digits.length >= 10 ? digits.slice(-10) : digits;
}
function extractStringValue(val) {
    if (!val)
        return '';
    if (typeof val.stringValue === 'string')
        return val.stringValue.trim();
    if (typeof val.numberValue === 'number')
        return String(val.numberValue);
    if (val.listValue?.values?.length) {
        return val.listValue.values.map((v) => extractStringValue(v)).filter(Boolean).join(', ');
    }
    return '';
}
function parseFormFields(fields) {
    const map = {};
    if (!fields)
        return map;
    for (const [key, val] of Object.entries(fields)) {
        const s = extractStringValue(val);
        if (s)
            map[key.toLowerCase().replace(/\s+/g, '_')] = s;
    }
    return map;
}
function pickField(map, ...hints) {
    for (const [k, v] of Object.entries(map)) {
        if (hints.some((h) => k.includes(h)))
            return v;
    }
    return '';
}
function parseFormSubmission(sub) {
    const id = String(sub.id ?? '').trim();
    if (!id)
        return null;
    const map = parseFormFields(sub.submissions);
    const first = pickField(map, 'first_name', 'firstname', 'first');
    const last = pickField(map, 'last_name', 'lastname', 'last');
    const full = pickField(map, 'full_name', 'name', 'your_name');
    const name = full || `${first} ${last}`.trim() || 'Unknown';
    const email = pickField(map, 'email', 'e_mail');
    const phone = pickField(map, 'phone', 'telephone', 'mobile', 'cell');
    const message = pickField(map, 'message', 'comment', 'comments', 'question', 'details', 'inquiry', 'notes') ||
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
function isLikelyWebsiteInquiryContact(c) {
    const st = String(c.source?.sourceType ?? '');
    if (st === 'WIX_FORMS' || st === 'WIX_CHAT' || st === 'HOPP')
        return true;
    const at = String(c.lastActivity?.activityType ?? '');
    return at === 'FORM_SUBMITTED' || at === 'INBOX_FORM_SUBMITTED';
}
function pickPhone(c) {
    const primary = String(c.primaryInfo?.phone ?? '').trim();
    if (primary)
        return primary;
    const items = c.info?.phones?.items ?? [];
    const primaryItem = items.find((p) => p.primary);
    return String(primaryItem?.e164Phone ?? primaryItem?.phone ?? items[0]?.e164Phone ?? items[0]?.phone ?? '').trim();
}
function pickEmail(c) {
    const primary = String(c.primaryInfo?.email ?? '').trim();
    if (primary)
        return primary;
    const items = c.info?.emails?.items ?? [];
    const primaryItem = items.find((e) => e.primary);
    return String(primaryItem?.email ?? items[0]?.email ?? '').trim();
}
function pickName(c) {
    const f = String(c.info?.name?.first ?? '').trim();
    const l = String(c.info?.name?.last ?? '').trim();
    const full = `${f} ${l}`.trim();
    return full || 'Unknown';
}
function pickMessage(c) {
    const ext = c.info?.extendedFields?.items;
    if (!ext || typeof ext !== 'object')
        return '';
    const chunks = [];
    for (const [, value] of Object.entries(ext)) {
        if (value && typeof value === 'object' && 'stringValue' in value) {
            const v = value.stringValue;
            if (typeof v === 'string' && v.trim())
                chunks.push(v.trim());
        }
    }
    return chunks.join('\n').trim();
}
async function wixFetchJson(url, init) {
    const res = await fetch(url, { ...init, headers: { ...wixHeaders(), ...(init?.headers ?? {}) } });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Wix API ${res.status} ${url}: ${txt.slice(0, 400)}`);
    }
    return (await res.json());
}
async function fetchWixFormSubmissions(since) {
    const all = [];
    let cursor;
    const sinceIso = since.toISOString();
    for (let page = 0; page < 20; page++) {
        const body = {
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
        const json = await wixFetchJson('https://www.wixapis.com/form-submission/v4/submissions/namespace/query', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        const raw = json.submissions ?? [];
        for (const sub of raw) {
            if (isOnOrAfter(sub.createdDate, since))
                all.push(sub);
        }
        const oldestRaw = raw[raw.length - 1];
        if (raw.length > 0 && oldestRaw && !isOnOrAfter(oldestRaw.createdDate, since))
            break;
        const next = json.metadata?.cursors?.next;
        if (!next || !json.metadata?.hasNext)
            break;
        cursor = next;
    }
    return all;
}
async function fetchWixInquiryContacts(since) {
    const all = [];
    let offset = 0;
    const limit = 100;
    const sinceIso = since.toISOString();
    for (let page = 0; page < 15; page++) {
        const json = await wixFetchJson('https://www.wixapis.com/contacts/v4/contacts/query', {
            method: 'POST',
            body: JSON.stringify({
                query: {
                    filter: { createdDate: { $gte: sinceIso } },
                    paging: { limit, offset },
                    sort: [{ fieldName: 'createdDate', order: 'DESC' }],
                },
            }),
        });
        const raw = (json.contacts ?? []).filter(isLikelyWebsiteInquiryContact);
        for (const c of raw) {
            if (isOnOrAfter(c.createdDate, since))
                all.push(c);
        }
        const oldestRaw = raw[raw.length - 1];
        if ((json.contacts?.length ?? 0) < limit || (oldestRaw && !isOnOrAfter(oldestRaw.createdDate, since)))
            break;
        offset += limit;
    }
    return all;
}
async function buildPatientPhoneSet() {
    const snap = await db.collection('patients').get();
    const out = new Set();
    snap.forEach((d) => {
        const row = d.data();
        if (Number(row.status ?? 0) === 3 || Number(row.status ?? 0) === 4)
            return;
        const h = phoneMatchKey(normalizePhoneDigits(row.home_phone));
        const m = phoneMatchKey(normalizePhoneDigits(row.mobile_phone));
        if (h)
            out.add(h);
        if (m)
            out.add(m);
    });
    return out;
}
function contactToUpsert(c) {
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
async function runWixInquirySync(options) {
    const since = sinceDateFromOptions(options);
    const mode = options?.mode ?? 'manual_week';
    const sinceIso = since.toISOString();
    const patientPhones = await buildPatientPhoneSet();
    const nowIso = new Date().toISOString();
    const upserts = [];
    const phoneKeysFromForms = new Set();
    let formSubmissions = 0;
    try {
        const forms = await fetchWixFormSubmissions(since);
        for (const sub of forms) {
            const row = parseFormSubmission(sub);
            if (!row)
                continue;
            const phoneKey = phoneMatchKey(normalizePhoneDigits(row.phone));
            if (phoneKey)
                phoneKeysFromForms.add(phoneKey);
            upserts.push({ docId: `form-${row.wixSubmissionId}`, ...row });
            formSubmissions += 1;
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('403') && !msg.includes('404')) {
            console.warn('Wix form submissions sync skipped:', msg);
        }
    }
    let contacts = 0;
    const wixContacts = await fetchWixInquiryContacts(since);
    for (const c of wixContacts) {
        const phoneKey = phoneMatchKey(normalizePhoneDigits(pickPhone(c)));
        if (phoneKey && phoneKeysFromForms.has(phoneKey))
            continue;
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
            batch.set(db.collection('wixInquiries').doc(row.docId), {
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
            }, { merge: true });
        }
        await batch.commit();
    }
    const existing = await db.collection('wixInquiries').get();
    const deleteBatch = db.batch();
    let deletes = 0;
    existing.forEach((d) => {
        const data = d.data();
        const missingWixId = !String(data.wixContactId ?? '').trim() && !String(data.wixSubmissionId ?? '').trim();
        const name = String(data.name ?? '').trim().toLowerCase();
        const phone = normalizePhoneDigits(String(data.phone ?? ''));
        const knownDummy = (name === 'ben carter' && phone.endsWith('9055552233')) ||
            (name === 'aisha malik' && phone.endsWith('9055551122'));
        if (missingWixId || knownDummy) {
            deleteBatch.delete(d.ref);
            deletes += 1;
        }
    });
    if (deletes > 0)
        await deleteBatch.commit();
    return { leads: upserts.length, formSubmissions, contacts, sinceIso, mode };
}
function mapWixError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('meta-site') && msg.includes('not found')) {
        throw new https_1.HttpsError('failed-precondition', `WIX_SITE_ID does not match this API key. Set Firebase secret WIX_SITE_ID to your site id (${exports.DEFAULT_WIX_SITE_ID}).`);
    }
    throw new https_1.HttpsError('internal', msg);
}
exports.syncWixInquiries = (0, https_1.onCall)({ secrets: [WIX_API_KEY, WIX_SITE_ID] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    }
    try {
        const lookbackDays = Number(request.data?.lookbackDays ?? 7);
        return await runWixInquirySync({
            mode: 'manual_week',
            sinceDays: Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 7,
        });
    }
    catch (error) {
        mapWixError(error);
    }
});
/** Check for new website inquiries every 5 minutes (last 24h window). */
/** Admin-only: create Firebase Auth user + Firestore profile with password. */
exports.createStaffUser = (0, https_1.onCall)(async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    }
    await requireAdmin(request.auth.uid);
    const data = request.data;
    const email = String(data.email ?? '').trim().toLowerCase();
    const password = String(data.password ?? '');
    const displayName = String(data.displayName ?? '').trim() || email.split('@')[0];
    const role = data.role === 'admin' ? 'admin' : 'staff';
    if (!email || !email.includes('@')) {
        throw new https_1.HttpsError('invalid-argument', 'A valid email is required.');
    }
    if (password.length < 6) {
        throw new https_1.HttpsError('invalid-argument', 'Password must be at least 6 characters.');
    }
    try {
        const userRecord = await authAdmin.createUser({ email, password, displayName });
        await db.collection('users').doc(userRecord.uid).set({
            uid: userRecord.uid,
            email,
            displayName,
            role,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            createdBy: request.auth.token.email ?? null,
        });
        return { uid: userRecord.uid, email, displayName, role };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('email-already-exists')) {
            throw new https_1.HttpsError('already-exists', 'An account with this email already exists.');
        }
        throw new https_1.HttpsError('internal', msg);
    }
});
exports.syncWixInquiriesScheduled = (0, scheduler_1.onSchedule)({
    schedule: 'every 5 minutes',
    secrets: [WIX_API_KEY, WIX_SITE_ID],
    timeZone: 'America/Toronto',
}, async () => {
    try {
        const result = await runWixInquirySync({
            mode: 'scheduled_incremental',
            sinceDays: 1,
        });
        console.log('Wix inquiry sync (scheduled)', result);
    }
    catch (error) {
        console.error('Wix inquiry sync failed', error);
    }
});
//# sourceMappingURL=index.js.map