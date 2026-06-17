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
import { NOT_REBOOKED_REASON_OPTIONS } from '../lib/notRebookedReasons';
import { APPOINTMENTS_QUERY_LIMIT } from '../lib/appointmentsQuery';
import { appendTimestampedFollowUpNote, latestNotePreview } from '../lib/followUpNotes';
import {
    cleanDentrixText,
    formatDentrixDateKey,
    formatDentrixTimeLabel,
    formatPatientFullName,
    getPatientBestPhone,
    isActiveDentrixPatient,
    type DentrixAppointmentDoc,
    type DentrixFollowUpWorkItem,
    type DentrixPatientAppointmentInfoDoc,
    type DentrixPatientDoc,
} from '../lib/dentrix';

interface FollowUpTrackingDoc {
    id: string;
    patient_id?: number;
    status?: string;
    outcome?: string;
    notes?: string;
    notRebookedReason?: string;
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
}

type BookingDraft = { date: string; type: string };

export interface FollowUpsPageProps {
    /** Render inside No future appointments hub (no duplicate page chrome). */
    embedded?: boolean;
}

const FollowUpsPage: React.FC<FollowUpsPageProps> = ({ embedded = false }) => {
    const { user, userProfile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [bookingDraft, setBookingDraft] = useState<BookingDraft>({ date: '', type: '' });
    const [providerFilter, setProviderFilter] = useState<string>('all');
    const [minMissedFilter, setMinMissedFilter] = useState<number>(1);
    const [statusFilter, setStatusFilter] = useState<'open' | 'booked' | 'all'>('open');
    const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
    const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
    const [latestAppointmentByPatientId, setLatestAppointmentByPatientId] = useState<Record<string, DentrixAppointmentDoc>>({});
    const [trackingByPatientId, setTrackingByPatientId] = useState<Record<string, FollowUpTrackingDoc>>({});
    const [logModalItem, setLogModalItem] = useState<(DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc }) | null>(null);

    useEffect(() => {
        const unsubPatients = onSnapshot(collection(db, 'patients'), (snap) => {
            const map: Record<string, DentrixPatientDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setPatientsById(map);
            setLoading(false);
        });

        const unsubPatientInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
            const map: Record<string, DentrixPatientAppointmentInfoDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setPatientInfoById(map);
            setLoading(false);
        });

        const unsubAppointments = onSnapshot(
            query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(APPOINTMENTS_QUERY_LIMIT)),
            (snap) => {
                const map: Record<string, DentrixAppointmentDoc> = {};
                snap.docs.forEach((d) => {
                    const row = { id: d.id, ...d.data() } as DentrixAppointmentDoc;
                    const key = String(row.patient_id ?? '');
                    if (!key || map[key]) return;
                    map[key] = row;
                });
                setLatestAppointmentByPatientId(map);
            }
        );

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

        return () => {
            unsubPatients();
            unsubPatientInfo();
            unsubAppointments();
            unsubTracking();
        };
    }, []);

    const items = useMemo(() => {
        const rows: (DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc })[] = [];
        Object.values(patientInfoById).forEach((info) => {
            const patientKey = String(info.patient_id ?? info.id);
            const missed = Number(info.number_of_missed_appointments ?? 0);
            if (missed < 1) return;

            const nextAppt = formatDentrixDateKey(info.next_appointment_date);
            if (nextAppt) return;

            const patient = patientsById[patientKey];
            if (patient && !isActiveDentrixPatient(patient)) return;

            const latestAppt = latestAppointmentByPatientId[patientKey];
            const tracking = trackingByPatientId[patientKey];

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
                nextAppointmentDate: nextAppt,
                latestReason: cleanDentrixText(latestAppt?.reason) || 'General appointment',
                latestProvider: cleanDentrixText(latestAppt?.provider_id) || 'Unassigned',
                latestAppointmentDate: formatDentrixDateKey(latestAppt?.appointment_date),
                latestAppointmentTime: formatDentrixTimeLabel(latestAppt?.start_hour, latestAppt?.start_minute),
                trackingId: `dentrix-${patientKey}`,
                tracking,
            });
        });

        rows.sort((a, b) => b.missedAppointments - a.missedAppointments);

        return rows;
    }, [patientInfoById, patientsById, latestAppointmentByPatientId, trackingByPatientId]);

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
        await setDoc(doc(db, 'followUps', item.trackingId), payload, { merge: true });
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

    const selectedForNote = items.find((x) => x.patientId === activeNoteId);
    const selectedForBooking = items.find((x) => x.patientId === bookingId);

    return (
        <div
            className={
                embedded
                    ? 'space-y-8 max-w-full font-sans'
                    : 'p-8 space-y-12 max-w-full mx-auto bg-white font-sans pb-20'
            }
        >
            <div
                className={
                    embedded
                        ? 'flex flex-col md:flex-row items-center justify-between gap-4 border-b pb-4 border-slate-100'
                        : 'flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2'
                }
            >
                <div>
                    {embedded ? (
                        <>
                            <p className="text-[9px] font-black text-teal-600 uppercase tracking-widest">No appt booked</p>
                            <p className="text-[11px] font-bold text-slate-500 mt-1">
                                {items.length} active patients with missed visits and no next appointment
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">
                                No follow up appt booked
                            </h1>
                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">
                                {items.length} active patients with missed visits and no next appointment
                            </p>
                        </>
                    )}
                </div>
                <div className="relative w-full md:max-w-xs transition-all">
                    <Input
                        placeholder="Search Patient / ID / Reason..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className={
                            embedded
                                ? 'h-10 text-xs font-bold border-slate-200'
                                : 'pl-6 h-12 bg-slate-50 border-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-tight placeholder:text-slate-200 focus:bg-white focus:ring-teal-500/10 focus:border-teal-500 transition-all shadow-sm'
                        }
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="h-11 px-4 rounded-xl border border-slate-100 bg-white text-[10px] font-black uppercase tracking-widest">
                    <option value="all">All Providers</option>
                    {providerOptions.map((provider) => (
                        <option key={provider} value={provider}>{provider}</option>
                    ))}
                </select>
                <select value={String(minMissedFilter)} onChange={(e) => setMinMissedFilter(Number(e.target.value))} className="h-11 px-4 rounded-xl border border-slate-100 bg-white text-[10px] font-black uppercase tracking-widest">
                    <option value="1">1+ Missed</option>
                    <option value="2">2+ Missed</option>
                    <option value="3">3+ Missed</option>
                    <option value="4">4+ Missed</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'open' | 'booked' | 'all')} className="h-11 px-4 rounded-xl border border-slate-100 bg-white text-[10px] font-black uppercase tracking-widest">
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
                    className="h-11 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest"
                >
                    Reset Filters
                </Button>
            </div>

            {loading ? (
                <div className="p-40 text-center uppercase text-[10px] font-black opacity-10 tracking-[0.3em]">Syncing...</div>
            ) : (
                <div className="bg-white border border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden min-h-[500px]">
                    <div className="overflow-x-auto max-h-[calc(100vh-18rem)] overflow-y-auto">
                        <table className="w-full text-left border-collapse min-w-[1280px]">
                            <thead className="sticky top-0 z-10 bg-slate-50">
                                <tr className="border-b border-slate-100/50">
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] pl-10">
                                        Patient
                                        <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-1">
                                            Tap name for contact card
                                        </span>
                                    </th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] min-w-[140px]">
                                        Why not rebooked
                                    </th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Missed</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Last Appointment</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Outreach</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Notes / Outcome</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] pr-10 text-right">Booking</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filtered.map((item) => (
                                    <tr key={item.patientId} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="p-6 pl-10">
                                            <PatientProfileTrigger patientId={item.patientId}>
                                                <div className="text-xs font-black text-slate-900 uppercase tracking-tighter truncate leading-none">
                                                    {item.patientName}
                                                </div>
                                                <div className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-1.5 opacity-60 leading-none pointer-events-none">
                                                    ID {item.patientId} • {item.phone}
                                                </div>
                                            </PatientProfileTrigger>
                                        </td>
                                        <td className="p-6">
                                            <select
                                                className="w-full max-w-[160px] h-9 rounded-xl border border-slate-100 text-[9px] font-black uppercase bg-white disabled:opacity-40"
                                                disabled={!!updatingId || !!item.tracking?.nextAppointmentBooked}
                                                value={item.tracking?.notRebookedReason ?? ''}
                                                onChange={(e) =>
                                                    upsertTracking(item, {
                                                        notRebookedReason: e.target.value || undefined,
                                                    })
                                                }
                                            >
                                                {NOT_REBOOKED_REASON_OPTIONS.map((o) => (
                                                    <option key={o.value || 'empty'} value={o.value}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="p-6">
                                            <div className="text-xs font-black text-rose-600">{item.missedAppointments}</div>
                                            <div className="text-[9px] text-slate-400 uppercase tracking-wider">
                                                Last missed {item.lastMissedDate ?? 'N/A'}
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <p className="text-[11px] font-black text-slate-800 uppercase tracking-tight leading-none">{item.latestReason}</p>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2 opacity-70">
                                                {item.latestAppointmentDate ?? 'N/A'} {item.latestAppointmentTime} • {item.latestProvider}
                                            </p>
                                        </td>
                                        <td className="p-6">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!!updatingId}
                                                onClick={() => setLogModalItem(item)}
                                                className="h-9 px-4 text-[9px] font-black uppercase tracking-widest rounded-xl border-slate-200"
                                            >
                                                Log follow-up
                                            </Button>
                                        </td>
                                        <td className="p-6">
                                            <div className="max-w-[320px]">
                                                <button
                                                    onClick={() => {
                                                        setActiveNoteId(item.patientId);
                                                        setNoteDraft(item.tracking?.notes ?? '');
                                                    }}
                                                    className="text-left w-full"
                                                >
                                                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-tight leading-relaxed">
                                                        {item.tracking?.notes ? latestNotePreview(item.tracking.notes, 120) : 'Add internal note'}
                                                    </p>
                                                    {item.tracking?.lastNoteAt && (
                                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                                                            Last note {format(new Date(item.tracking.lastNoteAt), 'MMM d, h:mm a')}
                                                        </p>
                                                    )}
                                                </button>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2">
                                                    {item.tracking?.outcome || 'No outcome yet'}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="p-6 pr-10 text-right">
                                            <Button
                                                size="sm"
                                                onClick={() => setBookingId(item.patientId)}
                                                className="h-8 px-4 bg-slate-900 hover:bg-slate-800 text-white text-[9px] font-black uppercase tracking-widest rounded-xl"
                                            >
                                                Set Next Appt
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
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
