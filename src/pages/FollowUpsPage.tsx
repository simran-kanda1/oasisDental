import React, { useMemo, useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, setDoc, limit, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import {
    cleanDentrixText,
    formatDentrixDateKey,
    formatDentrixTimeLabel,
    formatPatientFullName,
    getPatientBestPhone,
    getPatientRiskLevel,
    getRiskBadgeClass,
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
    lastChanged?: string;
    followUpDate?: string;
    nextAppointmentBooked?: boolean;
    nextAppointmentDate?: string;
    source?: string;
}

type BookingDraft = { date: string; type: string };

const ACTION_BUTTON_CLASS =
    'h-8 px-3 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest flex items-center justify-center transition-all bg-white hover:bg-slate-50 text-slate-400 hover:text-teal-600 disabled:opacity-50';

const FollowUpsPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [bookingDraft, setBookingDraft] = useState<BookingDraft>({ date: '', type: '' });
    const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
    const [providerFilter, setProviderFilter] = useState<string>('all');
    const [minMissedFilter, setMinMissedFilter] = useState<number>(1);
    const [statusFilter, setStatusFilter] = useState<'open' | 'booked' | 'all'>('open');
    const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
    const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
    const [latestAppointmentByPatientId, setLatestAppointmentByPatientId] = useState<Record<string, DentrixAppointmentDoc>>({});
    const [trackingByPatientId, setTrackingByPatientId] = useState<Record<string, FollowUpTrackingDoc>>({});

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
            query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000)),
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
                risk: getPatientRiskLevel(missed),
                trackingId: `dentrix-${patientKey}`,
                tracking,
            });
        });

        rows.sort((a, b) => {
            const riskRank = { high: 0, medium: 1, low: 2 };
            if (riskRank[a.risk] !== riskRank[b.risk]) return riskRank[a.risk] - riskRank[b.risk];
            return b.missedAppointments - a.missedAppointments;
        });

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
            const matchesRisk = riskFilter === 'all' || item.risk === riskFilter;
            const matchesProvider = providerFilter === 'all' || item.latestProvider === providerFilter;
            const matchesMissed = item.missedAppointments >= minMissedFilter;
            const isBooked = !!item.tracking?.nextAppointmentBooked;
            const matchesStatus = statusFilter === 'all' || (statusFilter === 'booked' ? isBooked : !isBooked);
            return matchesSearch && matchesRisk && matchesProvider && matchesMissed && matchesStatus;
        });
    }, [items, search, riskFilter, providerFilter, minMissedFilter, statusFilter]);

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
            lastChanged: new Date().toISOString(),
            contactedBy: userProfile?.displayName ?? user?.email ?? 'User',
            ...patch,
        };
        await setDoc(doc(db, 'followUps', item.trackingId), payload, { merge: true });
    };

    const logAction = async (
        item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc },
        action: string,
        extra?: string
    ) => {
        setUpdatingId(item.patientId);
        await upsertTracking(item, {
            status: action.toLowerCase(),
            outcome: extra ? `${action}: ${extra}` : action,
            followUpDate: action === 'Later' ? extra : undefined,
            nextAppointmentBooked: false,
        });
        if (user?.uid && user.email) {
            await logActivity({
                userId: user.uid,
                userEmail: user.email,
                userName: userProfile?.displayName ?? user.email,
                action: `Follow-up ${action}: ${item.patientName}`,
                section: 'Follow-Ups',
            });
        }
        setUpdatingId(null);
    };

    const saveNote = async (item: DentrixFollowUpWorkItem & { trackingId: string; tracking?: FollowUpTrackingDoc }) => {
        setUpdatingId(item.patientId);
        await upsertTracking(item, {
            notes: noteDraft,
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
        <div className="p-8 space-y-12 max-w-full mx-auto bg-white font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Follow Ups</h1>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">{items.length} Recall Patients Need Outreach</p>
                </div>
                <div className="relative w-full md:max-w-xs transition-all">
                    <Input
                        placeholder="Search Patient / ID / Reason..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-6 h-12 bg-slate-50 border-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-tight placeholder:text-slate-200 focus:bg-white focus:ring-teal-500/10 focus:border-teal-500 transition-all shadow-sm"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')} className="h-11 px-4 rounded-xl border border-slate-100 bg-white text-[10px] font-black uppercase tracking-widest">
                    <option value="all">All Risks</option>
                    <option value="high">High Risk</option>
                    <option value="medium">Medium Risk</option>
                    <option value="low">Low Risk</option>
                </select>
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
                        setRiskFilter('all');
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
                    <div className="overflow-x-auto scrollbar-none">
                        <table className="w-full text-left border-collapse min-w-[1300px]">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100/50">
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] pl-10">Patient</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Risk</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Missed</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Last Appointment</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Outreach Actions</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Notes / Outcome</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] pr-10 text-right">Booking</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filtered.map((item) => (
                                    <tr key={item.patientId} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="p-6 pl-10">
                                            <div className="text-xs font-black text-slate-900 uppercase tracking-tighter truncate leading-none">{item.patientName}</div>
                                            <div className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-1.5 opacity-60 leading-none">
                                                ID {item.patientId} • {item.phone}
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <span className={`inline-flex h-8 items-center px-3 rounded-xl border text-[9px] font-black uppercase tracking-widest ${getRiskBadgeClass(item.risk)}`}>
                                                {item.risk}
                                            </span>
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
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button onClick={() => logAction(item, 'Call')} disabled={!!updatingId} className={ACTION_BUTTON_CLASS}>Call</button>
                                                <button onClick={() => logAction(item, 'VM')} disabled={!!updatingId} className={ACTION_BUTTON_CLASS}>VM</button>
                                                <button onClick={() => logAction(item, 'Text')} disabled={!!updatingId} className={ACTION_BUTTON_CLASS}>Text</button>
                                                <button onClick={() => logAction(item, 'Later', format(new Date(), 'yyyy-MM-dd'))} disabled={!!updatingId} className={ACTION_BUTTON_CLASS}>Later</button>
                                            </div>
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
                                                        {item.tracking?.notes || 'Add internal note'}
                                                    </p>
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
