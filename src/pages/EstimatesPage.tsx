import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, doc, setDoc, updateDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import { FOLLOW_UP_QUEUE_OUTREACH } from '../lib/followUpQueues';
import {
    cleanDentrixText,
    formatDentrixDateKey,
    formatDentrixTimeLabel,
    isActiveDentrixPatient,
    type DentrixAppointmentDoc,
    type DentrixPatientDoc,
} from '../lib/dentrix';
import { isEstimateSent } from '../lib/appointmentHeuristics';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';

interface EstimateRow {
    id: string;
    appointmentDocId: string;
    patientId: string;
    patientName: string;
    reason: string;
    provider: string;
    date: string | null;
    time: string;
    amount: number;
    statusId: number;
}

const EstimatesPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        const q = query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000));
        const unsub = onSnapshot(q, (snap) => {
            setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
            setLoading(false);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'patients'), (snap) => {
            const map: Record<string, DentrixPatientDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setPatientsById(map);
        });
        return unsub;
    }, []);

    const estimateRows = useMemo<EstimateRow[]>(() => {
        return appointments
            .filter((a) => Number(a.amount ?? 0) > 0 || Number(a.production_type ?? 0) > 0)
            .filter((a) => !isEstimateSent(a))
            .filter((a) => {
                const pid = String(a.patient_id ?? '');
                const p = patientsById[pid];
                if (!p) return true;
                return isActiveDentrixPatient(p);
            })
            .slice(0, 600)
            .map((a) => ({
                id: `dentrix-${a.id}`,
                appointmentDocId: a.id,
                patientId: String(a.patient_id ?? ''),
                patientName: cleanDentrixText(a.patient_name) || `Patient #${a.patient_id ?? a.id}`,
                reason: cleanDentrixText(a.reason) || 'Treatment plan',
                provider: cleanDentrixText(a.provider_id) || 'N/A',
                date: formatDentrixDateKey(a.appointment_date),
                time: formatDentrixTimeLabel(a.start_hour, a.start_minute),
                amount: Number(a.amount ?? 0),
                statusId: Number(a.status_id ?? 0),
            }));
    }, [appointments, patientsById]);

    const handleLogAction = async (row: EstimateRow, type: string) => {
        setUpdatingId(row.id);
        await updateDoc(doc(db, 'appointments', row.appointmentDocId), { estimate_sent: true });
        await setDoc(doc(db, 'followUps', row.id), {
            source: 'dentrix',
            queue: FOLLOW_UP_QUEUE_OUTREACH,
            patient_id: Number(row.patientId),
            patient_name: row.patientName,
            lastChanged: new Date().toISOString(),
            contactedBy: userProfile?.displayName ?? user?.email ?? 'User',
            outcome: `${type}: Estimate sent`,
            status: 'estimate_followup',
            nextAppointmentBooked: false,
            category: row.reason,
            provider_id: row.provider,
        }, { merge: true });
        await logActivity({
            userId: user!.uid,
            userEmail: user!.email!,
            userName: userProfile?.displayName ?? user!.email!,
            action: `Sent estimate: ${row.patientName}`,
            section: 'Estimates'
        });
        setUpdatingId(null);
    };

    const filtered = estimateRows.filter(e =>
        e.patientName.toLowerCase().includes(search.toLowerCase()) ||
        e.reason.toLowerCase().includes(search.toLowerCase()) ||
        e.patientId.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="p-8 space-y-12 max-w-full mx-auto bg-slate-50/50 font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Estimates to send</h1>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">
                        Treatment rows with production where estimate sent is false — Send marks estimate_sent on the appointment
                    </p>
                </div>
                <div className="relative w-full md:max-w-xs transition-all">
                    <Input
                        placeholder="Search Registry..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-6 h-12 bg-white border-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-tight placeholder:text-slate-200 focus:ring-teal-500/10 focus:border-teal-500 transition-all shadow-sm"
                    />
                </div>
            </div>

            {loading ? (
                <div className="p-40 text-center uppercase text-[10px] font-black opacity-10 tracking-[0.3em]">Syncing...</div>
            ) : (
                <div className="bg-white border border-slate-100 rounded-[3rem] shadow-sm overflow-hidden shadow-teal-500/5">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100/50">
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] pl-12">
                                    Patient Name
                                    <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-1">
                                        Tap for contact card
                                    </span>
                                </th>
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Treatment</th>
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Schedule / Amount</th>
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] text-right pr-12">Portal Signal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filtered.map(e => (
                                <tr key={e.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-8 pl-12">
                                        <PatientProfileTrigger patientId={e.patientId} disabled={!e.patientId}>
                                            <p className="text-xs font-black text-slate-900 uppercase tracking-tighter leading-none">
                                                {e.patientName}
                                            </p>
                                            <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-2 opacity-60 pointer-events-none">
                                                ID: {e.patientId || 'N/A'}
                                            </p>
                                        </PatientProfileTrigger>
                                    </td>
                                    <td className="p-8">
                                        <p className="text-xs font-black text-slate-800 uppercase tracking-tighter leading-none transition-colors group-hover:text-teal-600">{e.reason}</p>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2 opacity-60">{e.provider}</p>
                                    </td>
                                    <td className="p-8">
                                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-none ml-1 opacity-60">
                                            {e.date ?? 'N/A'} {e.time}
                                        </p>
                                        <p className="text-[11px] font-black text-slate-600 uppercase tracking-tight mt-2">${e.amount.toLocaleString()}</p>
                                    </td>
                                    <td className="p-8 pr-12 text-right">
                                        <button
                                            onClick={() => handleLogAction(e, 'Email')}
                                            disabled={!!updatingId}
                                            className="h-10 px-8 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest bg-white hover:bg-slate-900 hover:text-white transition-all text-slate-400 active:scale-[0.98] shadow-sm active:shadow-inner"
                                        >
                                            Send Node
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default EstimatesPage;
