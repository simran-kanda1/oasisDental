import React, { useMemo, useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, setDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import {
    logActivity,
    ACTIVITY_SECTION_FOLLOW_UP_OUTREACH,
    buildOutreachActivityDetail,
} from '../lib/activityLogger';
import { FOLLOW_UP_QUEUE_OUTREACH } from '../lib/followUpQueues';
import { LogOutreachModal, type OutreachLogPayload } from '../components/LogOutreachModal';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import {
    cleanDentrixText,
    formatDentrixDateKey,
    formatDentrixTimeLabel,
    isActiveDentrixPatient,
    type DentrixAppointmentDoc,
    type DentrixPatientDoc,
} from '../lib/dentrix';
import {
    postVisitCategoryMatch,
    appointmentInPastWindow,
    type PostVisitCategory,
    type PostVisitWindow,
} from '../lib/postVisitFollowUp';

interface VisitRow {
    apptId: string;
    patientId: string;
    patientName: string;
    reason: string;
    provider: string;
    dateLabel: string | null;
    timeLabel: string;
    followUpDocId: string;
    /** Loaded merge state from followUps */
    outcome?: string;
    outreachHistory?: Array<Record<string, unknown>>;
    notes?: string;
}

const CATEGORIES: { id: PostVisitCategory; label: string }[] = [
    { id: 'emerg', label: 'Emergency' },
    { id: 'np', label: 'New patient' },
    { id: 'ortho', label: 'Ortho' },
    { id: 'estimate', label: 'Estimates' },
];

const WINDOWS: { id: PostVisitWindow; label: string }[] = [
    { id: 'week', label: 'Past week' },
    { id: 'month', label: 'Past month' },
    { id: '3mo', label: 'Past 3 months' },
];

const FollowUpOutreachPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
    const [followUpByDocId, setFollowUpByDocId] = useState<Record<string, Record<string, unknown>>>({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [window, setWindow] = useState<PostVisitWindow>('week');
    const [selectedCats, setSelectedCats] = useState<PostVisitCategory[]>(['emerg', 'np', 'ortho', 'estimate']);
    const [logRow, setLogRow] = useState<VisitRow | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);

    useEffect(() => {
        const q = query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000));
        const unsubA = onSnapshot(q, (snap) => {
            setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
            setLoading(false);
        });
        const unsubP = onSnapshot(collection(db, 'patients'), (snap) => {
            const map: Record<string, DentrixPatientDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setPatientsById(map);
        });
        const unsubFu = onSnapshot(collection(db, 'followUps'), (snap) => {
            const map: Record<string, Record<string, unknown>> = {};
            snap.docs.forEach((d) => {
                const data = d.data();
                if (String(data.kind ?? '') !== 'post_visit') return;
                map[d.id] = data as Record<string, unknown>;
            });
            setFollowUpByDocId(map);
        });
        return () => {
            unsubA();
            unsubP();
            unsubFu();
        };
    }, []);

    const visitRows = useMemo(() => {
        const now = new Date();
        const rows: VisitRow[] = [];
        const cats = selectedCats.length ? selectedCats : (['emerg', 'np', 'ortho', 'estimate'] as PostVisitCategory[]);
        for (const a of appointments) {
            const pid = String(a.patient_id ?? '');
            if (!pid) continue;
            const p = patientsById[pid];
            if (p && !isActiveDentrixPatient(p)) continue;
            if (!appointmentInPastWindow(a, now, window)) continue;
            const matchCat = cats.some((c) => postVisitCategoryMatch(c, a));
            if (!matchCat) continue;
            const fuId = `postvisit-${a.id}`;
            const fu = followUpByDocId[fuId];
            if (fu && fu.postVisitResolved === true) continue;
            rows.push({
                apptId: a.id,
                patientId: pid,
                patientName: cleanDentrixText(a.patient_name) || `Patient #${pid}`,
                reason: cleanDentrixText(a.reason) || cleanDentrixText(a.appointment_type) || 'Visit',
                provider: cleanDentrixText(a.provider_id) || '—',
                dateLabel: formatDentrixDateKey(a.appointment_date),
                timeLabel: formatDentrixTimeLabel(a.start_hour, a.start_minute),
                followUpDocId: fuId,
                outcome: fu ? String(fu.outcome ?? '') : undefined,
                outreachHistory: fu?.outreachHistory as Array<Record<string, unknown>> | undefined,
                notes: fu ? String(fu.notes ?? '') : undefined,
            });
        }
        rows.sort((a, b) => (b.dateLabel ?? '').localeCompare(a.dateLabel ?? ''));
        return rows;
    }, [appointments, patientsById, window, selectedCats, followUpByDocId]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return visitRows;
        return visitRows.filter(
            (r) =>
                r.patientName.toLowerCase().includes(q) ||
                r.reason.toLowerCase().includes(q) ||
                r.patientId.includes(q)
        );
    }, [visitRows, search]);

    const toggleCat = (c: PostVisitCategory) => {
        setSelectedCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
    };

    const saveLog = async (row: VisitRow, payload: OutreachLogPayload) => {
        setSavingId(row.followUpDocId);
        const entry = {
            at: new Date().toISOString(),
            channel: payload.channel,
            reached: payload.reached,
            outcome: payload.outcome,
            notes: payload.notes,
            callbackDate: payload.callbackDate || null,
            by: userProfile?.displayName ?? user?.email ?? 'User',
        };
        const prev = followUpByDocId[row.followUpDocId];
        const prevHistory = Array.isArray(prev?.outreachHistory) ? (prev.outreachHistory as Array<Record<string, unknown>>) : [];
        const outreachHistory = [...prevHistory, entry].slice(-25);
        const summary = `${payload.channel} / ${payload.reached}${payload.outcome ? ` — ${payload.outcome}` : ''}`;
        await setDoc(
            doc(db, 'followUps', row.followUpDocId),
            {
                source: 'dentrix',
                queue: FOLLOW_UP_QUEUE_OUTREACH,
                kind: 'post_visit',
                appointment_id: row.apptId,
                patient_id: Number(row.patientId),
                patient_name: row.patientName,
                lastChanged: new Date().toISOString(),
                contactedBy: userProfile?.displayName ?? user?.email ?? 'User',
                status: 'contacted',
                outcome: summary,
                followUpDate: payload.callbackDate || null,
                nextAppointmentBooked: false,
                postVisitResolved: true,
                category: row.reason,
                lastOutreach: entry,
                outreachHistory,
                notes: payload.notes.trim()
                    ? [row.notes, payload.notes].filter(Boolean).join('\n---\n')
                    : row.notes,
            },
            { merge: true }
        );
        if (user?.uid && user.email) {
            await logActivity({
                userId: user.uid,
                userEmail: user.email,
                userName: userProfile?.displayName ?? user.email,
                action: `Outreach logged: ${row.patientName}`,
                section: ACTIVITY_SECTION_FOLLOW_UP_OUTREACH,
                detail: buildOutreachActivityDetail({
                    channel: payload.channel,
                    reached: payload.reached,
                    outcome: payload.outcome,
                    notes: payload.notes,
                    callbackDate: payload.callbackDate,
                    patientId: row.patientId,
                    queue: 'outreach',
                }),
            });
        }
        setSavingId(null);
        setLogRow(null);
    };

    return (
        <div className="p-6 md:p-8 space-y-8 max-w-full mx-auto bg-white font-sans pb-20">
            <div className="border-b border-slate-100 pb-6">
                <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase">Follow up</h1>
                <p className="text-[11px] font-bold text-slate-500 mt-2 max-w-3xl">
                    Recent completed visits (emergency, new patient, ortho, estimates) — check in even if another appointment
                    is already booked. Use Log follow-up to document calls.
                </p>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-wrap gap-2">
                    {WINDOWS.map((w) => (
                        <button
                            key={w.id}
                            type="button"
                            onClick={() => setWindow(w.id)}
                            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                                window === w.id
                                    ? 'bg-teal-600 text-white border-teal-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
                <Input
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-xs h-10 text-xs font-bold border-slate-200"
                />
            </div>

            <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Include</p>
                <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleCat(c.id)}
                            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase border ${
                                selectedCats.includes(c.id)
                                    ? 'border-teal-500 bg-teal-50 text-teal-800'
                                    : 'border-slate-200 bg-slate-50 text-slate-400 line-through'
                            }`}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="p-24 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Loading…</div>
            ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm min-w-[800px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                                <th className="p-3 pl-4">
                                    Patient
                                    <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                                        Tap for contact card
                                    </span>
                                </th>
                                <th className="p-3">Visit</th>
                                <th className="p-3">When</th>
                                <th className="p-3">Last log</th>
                                <th className="p-3 pr-4 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center text-xs text-slate-400 font-bold uppercase">
                                        No visits in this window for the selected types
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((r) => (
                                    <tr key={r.followUpDocId} className="hover:bg-slate-50/80">
                                        <td className="p-3 pl-4">
                                            <PatientProfileTrigger patientId={r.patientId} className="normal-case font-bold text-left">
                                                <p className="font-bold text-slate-900">{r.patientName}</p>
                                                <p className="text-[10px] text-slate-400 font-normal pointer-events-none">ID {r.patientId}</p>
                                            </PatientProfileTrigger>
                                        </td>
                                        <td className="p-3">
                                            <p className="text-xs font-semibold text-slate-800">{r.reason}</p>
                                            <p className="text-[10px] text-slate-500">{r.provider}</p>
                                        </td>
                                        <td className="p-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                                            {r.dateLabel ?? '—'} {r.timeLabel}
                                        </td>
                                        <td className="p-3 text-xs text-slate-500 max-w-[200px] truncate">{r.outcome || '—'}</td>
                                        <td className="p-3 pr-4 text-right">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="text-[9px] font-black uppercase"
                                                disabled={!!savingId}
                                                onClick={() => setLogRow(r)}
                                            >
                                                Log follow-up
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <LogOutreachModal
                open={!!logRow}
                title="Log follow-up"
                patientLabel={logRow ? `${logRow.patientName} · ${logRow.dateLabel ?? ''}` : ''}
                onClose={() => setLogRow(null)}
                onSave={(payload) => (logRow ? saveLog(logRow, payload) : Promise.resolve())}
                saving={!!logRow && savingId === logRow.followUpDocId}
            />
        </div>
    );
};

export default FollowUpOutreachPage;
