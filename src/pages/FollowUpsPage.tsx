import React, { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { collection, doc, onSnapshot, query, setDoc, limit, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import {
    logActivity,
    ACTIVITY_SECTION_RECALL_QUEUE,
    buildOutreachActivityDetail,
} from '../lib/activityLogger';
import { FOLLOW_UP_QUEUE_RECALL, isRecallFollowUpDoc } from '../lib/followUpQueues';
import { LogOutreachModal, type OutreachLogPayload } from '../components/LogOutreachModal';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import { getNotRebookedReasonOptionsForQueue, queueReasonRemovalPatch, queueReasonRemovesFromList } from '../lib/notRebookedReasons';
import { NO_APPT_BOOKED_QUEUE_DEF, NO_APPT_BOOKED_QUEUE_ID } from '../data/queueRules';
import { UserX } from 'lucide-react';
import { useFrontDeskData } from '../contexts/FrontDeskDataContext';
import { APPOINTMENTS_QUERY_LIMIT } from '../lib/appointmentsQuery';
import { appendTimestampedFollowUpNote, latestNotePreview } from '../lib/followUpNotes';
import {
    isActiveScheduledAppointment,
    isAppointmentOnOrAfterToday,
} from '../lib/appointmentHeuristics';
import {
    cleanDentrixText,
    formatDentrixDateKey,
    formatDentrixTimeLabel,
    formatPatientFullName,
    getPatientBestPhone,
    isActiveDentrixPatient,
    parseDentrixDate,
    type DentrixAppointmentDoc,
    type DentrixFollowUpWorkItem,
    type DentrixPatientAppointmentInfoDoc,
    type DentrixPatientDoc,
} from '../lib/dentrix';

function patientHasAnyFutureAppointment(
    patientId: string,
    appointments: DentrixAppointmentDoc[],
    info: DentrixPatientAppointmentInfoDoc | undefined,
    today: Date
): boolean {
    if (
        appointments.some(
            (a) => String(a.patient_id ?? '') === patientId && isActiveScheduledAppointment(a, today)
        )
    ) {
        return true;
    }
    const nextD = parseDentrixDate(info?.next_appointment_date);
    return !!nextD && isAppointmentOnOrAfterToday(nextD, today);
}

function buildLatestAppointmentByPatientId(
    appointments: DentrixAppointmentDoc[]
): Record<string, DentrixAppointmentDoc> {
    const sorted = [...appointments].sort((a, b) =>
        (b.appointment_date ?? '').localeCompare(a.appointment_date ?? '')
    );
    const map: Record<string, DentrixAppointmentDoc> = {};
    for (const row of sorted) {
        const key = String(row.patient_id ?? '');
        if (!key || map[key]) continue;
        map[key] = row;
    }
    return map;
}

interface FollowUpTrackingDoc {
    id: string;
    patient_id?: number;
    status?: string;
    outcome?: string;
    notes?: string;
    notRebookedReason?: string;
    notRebookedReasonAt?: string;
    lastChanged?: string;
    followUpDate?: string;
    lastNoteAt?: string;
    lastNoteBy?: string;
    nextAppointmentBooked?: boolean;
    nextAppointmentDate?: string;
    source?: string;
    queue?: string;
    outreachHistory?: Array<Record<string, unknown>>;
    lastOutreach?: Record<string, unknown>;
    removedFromList?: boolean;
    removedAt?: string;
}

type BookingDraft = { date: string; type: string };

export interface FollowUpsPageProps {
    /** Render inside No future appointments hub (no duplicate page chrome). */
    embedded?: boolean;
}

const FollowUpsPage: React.FC<FollowUpsPageProps> = ({ embedded = false }) => {
    const { user, userProfile } = useAuth();
    const frontDeskData = useFrontDeskData();
    const [loading, setLoading] = useState(!embedded);
    const [search, setSearch] = useState('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [bookingDraft, setBookingDraft] = useState<BookingDraft>({ date: '', type: '' });
    const [providerFilter, setProviderFilter] = useState<string>('all');
    const [minMissedFilter, setMinMissedFilter] = useState<number>(1);
    const [statusFilter, setStatusFilter] = useState<'open' | 'booked' | 'all'>('open');
    const [localPatientsById, setLocalPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
    const [localPatientInfoById, setLocalPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
    const [localLatestAppointmentByPatientId, setLocalLatestAppointmentByPatientId] = useState<
        Record<string, DentrixAppointmentDoc>
    >({});
    const [localAllAppointments, setLocalAllAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [trackingByPatientId, setTrackingByPatientId] = useState<Record<string, FollowUpTrackingDoc>>({});
    const [logModalItem, setLogModalItem] = useState<(DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc }) | null>(null);

    const patientsById = embedded ? frontDeskData.patientsById : localPatientsById;
    const patientInfoById = embedded ? frontDeskData.patientInfoById : localPatientInfoById;
    const allAppointmentsForFutureCheck = embedded ? frontDeskData.allAppointments : localAllAppointments;
    const latestAppointmentByPatientId = useMemo(
        () =>
            embedded
                ? buildLatestAppointmentByPatientId(frontDeskData.allAppointments)
                : localLatestAppointmentByPatientId,
        [embedded, frontDeskData.allAppointments, localLatestAppointmentByPatientId]
    );

    useEffect(() => {
        // Always load recall tracking — embedded mode previously skipped this, so
        // remove / why-not-rebooked never appeared to save.
        const unsubTracking = onSnapshot(collection(db, 'followUps'), (snap) => {
            const map: Record<string, FollowUpTrackingDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as FollowUpTrackingDoc;
                if (row.source !== 'dentrix') return;
                if (typeof row.patient_id !== 'number') return;
                if (!isRecallFollowUpDoc(row as unknown as Record<string, unknown>)) return;
                map[String(row.patient_id)] = row;
            });
            setTrackingByPatientId(map);
        });

        if (embedded) {
            setLoading(frontDeskData.appointmentsLoading);
            return () => unsubTracking();
        }

        const unsubPatients = onSnapshot(collection(db, 'patients'), (snap) => {
            const map: Record<string, DentrixPatientDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setLocalPatientsById(map);
            setLoading(false);
        });

        const unsubPatientInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
            const map: Record<string, DentrixPatientAppointmentInfoDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setLocalPatientInfoById(map);
            setLoading(false);
        });

        const unsubAppointments = onSnapshot(
            query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(APPOINTMENTS_QUERY_LIMIT)),
            (snap) => {
                const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc));
                setLocalAllAppointments(rows);
                const map: Record<string, DentrixAppointmentDoc> = {};
                for (const row of rows) {
                    const key = String(row.patient_id ?? '');
                    if (!key || map[key]) continue;
                    map[key] = row;
                }
                setLocalLatestAppointmentByPatientId(map);
            }
        );

        return () => {
            unsubPatients();
            unsubPatientInfo();
            unsubAppointments();
            unsubTracking();
        };
    }, [embedded, frontDeskData.appointmentsLoading]);

    const items = useMemo(() => {
        const rows: (DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc })[] = [];
        const today = new Date();
        const appointmentsForFutureCheck = allAppointmentsForFutureCheck;

        Object.values(patientInfoById).forEach((info) => {
            const patientKey = String(info.patient_id ?? info.id);
            const missed = Number(info.number_of_missed_appointments ?? 0);
            if (missed < 1) return;

            const patient = patientsById[patientKey];
            if (patient && !isActiveDentrixPatient(patient)) return;

            if (patientHasAnyFutureAppointment(patientKey, appointmentsForFutureCheck, info, today)) {
                return;
            }

            const latestAppt = latestAppointmentByPatientId[patientKey];
            const tracking = trackingByPatientId[patientKey];
            if (tracking?.removedFromList) return;
            if (tracking?.notRebookedReason && queueReasonRemovesFromList(NO_APPT_BOOKED_QUEUE_ID, tracking.notRebookedReason)) {
                return;
            }

            const patientName =
                formatPatientFullName(patient?.first_name ?? info.first_name, patient?.last_name ?? info.last_name) ||
                cleanDentrixText(latestAppt?.patient_name) ||
                `Patient #${patientKey}`;

            rows.push({
                patientId: patientKey,
                patientGuid: cleanDentrixText(patient?.patient_guid ?? info.patient_guid),
                patientName,
                phone: patient ? getPatientBestPhone(patient) : 'N/A',
                email: cleanDentrixText(patient?.email) || 'N/A',
                missedAppointments: missed,
                lastMissedDate: formatDentrixDateKey(info.last_missed_appointment_date),
                lastAppointmentDate: formatDentrixDateKey(info.previous_appointment_date),
                nextAppointmentDate: formatDentrixDateKey(info.next_appointment_date),
                latestReason: cleanDentrixText(latestAppt?.reason) || 'General appointment',
                latestProvider: cleanDentrixText(latestAppt?.provider_id) || 'Unassigned',
                latestAppointmentDate: formatDentrixDateKey(latestAppt?.appointment_date),
                latestAppointmentTime: formatDentrixTimeLabel(latestAppt?.start_hour, latestAppt?.start_minute),
                trackingId: `dentrix-${patientKey}`,
                tracking,
            });
        });

        rows.sort((a, b) => {
            const aAppt =
                parseDentrixDate(a.latestAppointmentDate)?.getTime() ??
                parseDentrixDate(a.lastAppointmentDate)?.getTime() ??
                0;
            const bAppt =
                parseDentrixDate(b.latestAppointmentDate)?.getTime() ??
                parseDentrixDate(b.lastAppointmentDate)?.getTime() ??
                0;
            return bAppt - aAppt;
        });

        return rows;
    }, [
        patientInfoById,
        patientsById,
        latestAppointmentByPatientId,
        trackingByPatientId,
        allAppointmentsForFutureCheck,
    ]);

    const filtered = useMemo(() => {
        const queryText = search.trim().toLowerCase();
        return items.filter((item) => {
            const matchesSearch =
                !queryText ||
                item.patientName.toLowerCase().includes(queryText) ||
                item.patientId.toLowerCase().includes(queryText) ||
                item.latestReason.toLowerCase().includes(queryText);
            const matchesProvider = providerFilter === 'all' || item.latestProvider === providerFilter;
            const matchesMissed = item.missedAppointments >= minMissedFilter;
            const isBooked = !!item.tracking?.nextAppointmentBooked;
            const matchesStatus = statusFilter === 'all' || (statusFilter === 'booked' ? isBooked : !isBooked);
            return matchesSearch && matchesProvider && matchesMissed && matchesStatus;
        });
    }, [items, search, providerFilter, minMissedFilter, statusFilter]);

    const providerOptions = useMemo(() => {
        const providers = Array.from(new Set(items.map((item) => item.latestProvider))).filter(Boolean);
        providers.sort((a, b) => a.localeCompare(b));
        return providers;
    }, [items]);

    const upsertTracking = async (
        item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc },
        patch: Partial<FollowUpTrackingDoc>
    ) => {
        const payload = {
            patient_id: Number(item.patientId),
            patient_guid: item.patientGuid,
            patient_name: item.patientName,
            source: 'dentrix',
            queue: FOLLOW_UP_QUEUE_RECALL,
            lastChanged: new Date().toISOString(),
            contactedBy: userProfile?.displayName ?? user?.email ?? 'User',
            ...patch,
        };
        setTrackingByPatientId((prev) => ({
            ...prev,
            [item.patientId]: {
                ...(prev[item.patientId] ?? item.tracking ?? { id: item.trackingId }),
                id: item.trackingId,
                ...payload,
            } as FollowUpTrackingDoc,
        }));
        void setDoc(doc(db, 'followUps', item.trackingId), payload, { merge: true });
    };

    const saveOutreachLog = async (
        item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc },
        payload: OutreachLogPayload
    ) => {
        setUpdatingId(item.patientId);
        const entry = {
            at: new Date().toISOString(),
            channel: payload.channel,
            reached: payload.reached,
            outcome: payload.outcome,
            notes: payload.notes,
            callbackDate: payload.callbackDate || null,
            by: userProfile?.displayName ?? user?.email ?? 'User',
        };
        const prevHistory = Array.isArray(item.tracking?.outreachHistory) ? item.tracking!.outreachHistory! : [];
        const outreachHistory = [...prevHistory, entry].slice(-25);
        const summary = `${payload.channel} / ${payload.reached}${payload.outcome ? ` — ${payload.outcome}` : ''}`;
        const notePatch = payload.notes.trim()
            ? appendTimestampedFollowUpNote(
                  item.tracking?.notes,
                  payload.notes,
                  userProfile?.displayName ?? user?.email ?? 'User'
              )
            : {
                  notes: item.tracking?.notes,
                  lastNoteAt: item.tracking?.lastNoteAt,
                  lastNoteBy: item.tracking?.lastNoteBy,
              };
        const optimisticPatch: FollowUpTrackingDoc = {
            id: item.trackingId,
            patient_id: Number(item.patientId),
            status: 'contacted',
            outcome: summary,
            followUpDate: payload.callbackDate || undefined,
            nextAppointmentBooked: false,
            lastOutreach: entry,
            outreachHistory,
            source: 'dentrix',
            queue: FOLLOW_UP_QUEUE_RECALL,
            ...notePatch,
        };
        setTrackingByPatientId((prev) => ({ ...prev, [item.patientId]: optimisticPatch }));
        await upsertTracking(item, {
            status: 'contacted',
            outcome: summary,
            followUpDate: payload.callbackDate || undefined,
            nextAppointmentBooked: false,
            lastOutreach: entry,
            outreachHistory,
            ...(payload.notes.trim() ? notePatch : {
                      notes: item.tracking?.notes,
                      lastNoteAt: item.tracking?.lastNoteAt,
                      lastNoteBy: item.tracking?.lastNoteBy,
                  }),
        });
        if (user?.uid && user.email) {
            await logActivity({
                userId: user.uid,
                userEmail: user.email,
                userName: userProfile?.displayName ?? user.email,
                action: `Outreach logged: ${item.patientName}`,
                section: ACTIVITY_SECTION_RECALL_QUEUE,
                detail: buildOutreachActivityDetail({
                    channel: payload.channel,
                    reached: payload.reached,
                    outcome: payload.outcome,
                    notes: payload.notes,
                    callbackDate: payload.callbackDate,
                    patientId: item.patientId,
                    queue: 'recall',
                }),
            });
        }
        setUpdatingId(null);
        setLogModalItem(null);
    };

    const saveNote = async (item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc }) => {
        if (!noteDraft.trim()) return;
        setUpdatingId(item.patientId);
        const author = userProfile?.displayName ?? user?.email ?? 'User';
        await upsertTracking(item, {
            ...appendTimestampedFollowUpNote(item.tracking?.notes, noteDraft, author),
            status: item.tracking?.status ?? 'not_contacted',
        });
        setUpdatingId(null);
        setActiveNoteId(null);
        setNoteDraft('');
    };

    const completeBooking = async (item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc }) => {
        if (!bookingDraft.date || !bookingDraft.type) return;
        setUpdatingId(item.patientId);
        await upsertTracking(item, {
            status: 'completed',
            queue: FOLLOW_UP_QUEUE_RECALL,
            nextAppointmentBooked: true,
            nextAppointmentDate: bookingDraft.date,
            outcome: `Booked: ${bookingDraft.type} on ${bookingDraft.date}`,
        });
        setUpdatingId(null);
        setBookingId(null);
        setBookingDraft({ date: '', type: '' });
    };

    const recallReasonOptions = getNotRebookedReasonOptionsForQueue(NO_APPT_BOOKED_QUEUE_ID);

    const removeFromList = async (
        item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc }
    ) => {
        setUpdatingId(item.patientId);
        await upsertTracking(item, {
            removedFromList: true,
            removedAt: new Date().toISOString(),
        });
        setUpdatingId(null);
    };

    const selectedForNote = items.find((x) => x.patientId === activeNoteId);
    const selectedForBooking = items.find((x) => x.patientId === bookingId);

    return (
        <div className={embedded ? 'space-y-4 max-w-full font-sans' : 'p-8 space-y-6 max-w-full mx-auto bg-white font-sans pb-20'}>
            <div className="mb-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                <div>
                    <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                        {NO_APPT_BOOKED_QUEUE_DEF.label}
                    </h1>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
                        {NO_APPT_BOOKED_QUEUE_DEF.description}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1">
                        {filtered.length} patients · {items.length} unfiltered
                    </p>
                </div>
                <div className="relative w-full md:max-w-xs">
                    <Input
                        placeholder="Search patient / ID / reason…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="h-9 text-xs font-bold border-slate-200 rounded-md"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="h-9 px-3 rounded-md border border-slate-200 bg-white text-[10px] font-bold uppercase tracking-widest text-slate-600">
                    <option value="all">All Providers</option>
                    {providerOptions.map((provider) => (
                        <option key={provider} value={provider}>{provider}</option>
                    ))}
                </select>
                <select value={String(minMissedFilter)} onChange={(e) => setMinMissedFilter(Number(e.target.value))} className="h-9 px-3 rounded-md border border-slate-200 bg-white text-[10px] font-bold uppercase tracking-widest text-slate-600">
                    <option value="1">1+ Missed</option>
                    <option value="2">2+ Missed</option>
                    <option value="3">3+ Missed</option>
                    <option value="4">4+ Missed</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'open' | 'booked' | 'all')} className="h-9 px-3 rounded-md border border-slate-200 bg-white text-[10px] font-bold uppercase tracking-widest text-slate-600">
                    <option value="open">Open</option>
                    <option value="booked">Booked</option>
                    <option value="all">All</option>
                </select>
                <Button
                    variant="ghost"
                    onClick={() => {
                        setProviderFilter('all');
                        setMinMissedFilter(1);
                        setStatusFilter('open');
                        setSearch('');
                    }}
                    className="h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-600"
                >
                    Reset Filters
                </Button>
            </div>

            {loading ? (
                <div className="p-16 text-center uppercase text-[10px] font-black text-slate-300 tracking-widest">Syncing...</div>
            ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto bg-white">
                    <table className="w-full text-left text-sm min-w-[1100px]">
                            <thead className="sticky top-0 z-10 bg-slate-50">
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    <th className="p-3 pl-4 w-12">
                                        <span className="sr-only">Remove</span>
                                    </th>
                                    <th className="p-3">
                                        Patient
                                        <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                                            Tap row name for phone and notes
                                        </span>
                                    </th>
                                    <th className="p-3 min-w-[140px]">Why not rebooked</th>
                                    <th className="p-3">Last appointment</th>
                                    <th className="p-3">Outreach</th>
                                    <th className="p-3 pr-4 min-w-[200px]">Notes</th>
                                    <th className="p-3 pr-4 min-w-[148px]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((item) => (
                                    <tr key={item.patientId} className="hover:bg-slate-50/80 align-top">
                                        <td className="p-3 pl-4">
                                            <button
                                                type="button"
                                                title="Remove from list"
                                                aria-label={`Remove ${item.patientName} from list`}
                                                disabled={!!updatingId}
                                                onClick={() => void removeFromList(item)}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                                            >
                                                <UserX className="h-4 w-4" />
                                            </button>
                                        </td>
                                        <td className="p-3 font-bold text-slate-900">
                                            <PatientProfileTrigger patientId={item.patientId} className="font-bold">
                                                {item.patientName}
                                            </PatientProfileTrigger>
                                            <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                                                ID {item.patientId} · {item.phone} · {item.missedAppointments} missed
                                            </p>
                                        </td>
                                        <td className="p-3">
                                            <select
                                                className="w-full max-w-[160px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                                                disabled={!!updatingId || !!item.tracking?.nextAppointmentBooked}
                                                value={item.tracking?.notRebookedReason ?? ''}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    void upsertTracking(item, {
                                                        notRebookedReason: value || undefined,
                                                        notRebookedReasonAt: value ? new Date().toISOString() : undefined,
                                                        ...queueReasonRemovalPatch(NO_APPT_BOOKED_QUEUE_ID, value),
                                                    });
                                                }}
                                            >
                                                {recallReasonOptions.map((o) => (
                                                    <option key={o.value || 'empty'} value={o.value}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </select>
                                            {item.tracking?.notRebookedReason &&
                                            (item.tracking.notRebookedReasonAt || item.tracking.lastChanged) ? (
                                                <p className="text-[9px] text-slate-400 font-bold mt-1 tabular-nums">
                                                    Updated{' '}
                                                    {format(
                                                        new Date(
                                                            item.tracking.notRebookedReasonAt ??
                                                                item.tracking.lastChanged!
                                                        ),
                                                        'MMM d, yyyy h:mm a'
                                                    )}
                                                </p>
                                            ) : null}
                                        </td>
                                        <td className="p-3 text-slate-600 text-xs">
                                            <p>{item.latestReason}</p>
                                            <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                                                {item.latestAppointmentDate ?? '—'} {item.latestAppointmentTime} · {item.latestProvider}
                                            </p>
                                        </td>
                                        <td className="p-3">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!!updatingId}
                                                onClick={() => setLogModalItem(item)}
                                                className="h-8 text-[9px] font-black uppercase border-teal-300 text-teal-800 hover:bg-teal-50 whitespace-nowrap"
                                            >
                                                Log follow-up
                                            </Button>
                                        </td>
                                        <td className="p-3 pr-4">
                                            <div className="max-w-[320px]">
                                                <button
                                                    onClick={() => {
                                                        setActiveNoteId(item.patientId);
                                                        setNoteDraft(item.tracking?.notes ?? '');
                                                    }}
                                                    className="text-left w-full"
                                                >
                                                    <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
                                                        {item.tracking?.notes ? latestNotePreview(item.tracking.notes, 120) : 'Add internal note'}
                                                    </p>
                                                    {item.tracking?.lastNoteAt && (
                                                        <p className="text-[9px] text-slate-400 font-bold mt-1">
                                                            Last note {format(new Date(item.tracking.lastNoteAt), 'MMM d, yyyy h:mm a')}
                                                        </p>
                                                    )}
                                                </button>
                                                <p className="text-[9px] text-slate-400 font-bold mt-1">
                                                    {item.tracking?.outcome || 'No outcome yet'}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="p-3 pr-4 align-top">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setBookingId(item.patientId)}
                                                className="h-8 w-full text-[9px] font-black uppercase border-slate-200 text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                            >
                                                Set next appt
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                </div>
            )}

            {selectedForNote && (
                <>
                    <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[100]" onClick={() => setActiveNoteId(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 z-[101]">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-8">Clinical Note</h4>
                        <Input
                            autoFocus
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            placeholder="Type internal note..."
                            className="h-12 text-sm font-bold border-slate-100 bg-slate-50/50 rounded-2xl mb-8"
                            onKeyDown={(e) => e.key === 'Enter' && saveNote(selectedForNote)}
                        />
                        <div className="flex gap-4">
                            <Button onClick={() => saveNote(selectedForNote)} disabled={!!updatingId} className="flex-1 h-12 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl">Save Note</Button>
                            <Button variant="ghost" onClick={() => setActiveNoteId(null)} className="flex-1 h-12 border border-slate-100 text-[10px] font-black uppercase tracking-widest rounded-xl">Cancel</Button>
                        </div>
                    </div>
                </>
            )}

            <LogOutreachModal
                open={!!logModalItem}
                patientLabel={logModalItem ? `${logModalItem.patientName} · ID ${logModalItem.patientId}` : ''}
                onClose={() => setLogModalItem(null)}
                onSave={async (payload) => {
                    if (!logModalItem) return;
                    await saveOutreachLog(logModalItem, payload);
                }}
                saving={!!logModalItem && updatingId === logModalItem.patientId}
            />

            {selectedForBooking && (
                <>
                    <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[100]" onClick={() => setBookingId(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 z-[101]">
                        <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.3em] mb-8 border-b pb-4 border-slate-50">Book Next Appointment</h3>
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Appointment Type</label>
                                <Input
                                    value={bookingDraft.type}
                                    onChange={(e) => setBookingDraft(prev => ({ ...prev, type: e.target.value }))}
                                    placeholder="e.g. Recall Hygiene"
                                    className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Appointment Date</label>
                                <Input
                                    type="date"
                                    value={bookingDraft.date}
                                    onChange={(e) => setBookingDraft(prev => ({ ...prev, date: e.target.value }))}
                                    className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase"
                                />
                            </div>
                            <Button
                                onClick={() => completeBooking(selectedForBooking)}
                                disabled={!bookingDraft.date || !bookingDraft.type || !!updatingId}
                                className="w-full h-14 bg-teal-600 hover:bg-teal-700 text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-2xl"
                            >
                                Save Booking
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default FollowUpsPage;
