import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { FRONT_DESK_QUEUE_DEFS, buildQueueRows, type AgeBucketFilter } from '../data/queueRules';
import type { DentrixAppointmentDoc, DentrixPatientDoc } from '../lib/dentrix';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';

const AGE_OPTIONS: { id: AgeBucketFilter; label: string }[] = [
    { id: 'all', label: 'All dates' },
    { id: '0-3', label: 'Up to 3 mo' },
    { id: '3-6', label: '3–6 mo' },
    { id: '6-9', label: '6–9 mo' },
    { id: '9-12', label: '9–12 mo' },
    { id: '12+', label: '12 mo +' },
];

const FrontDeskQueuesPage: React.FC = () => {
    const [activeId, setActiveId] = useState(FRONT_DESK_QUEUE_DEFS[0].id);
    const [ageBucket, setAgeBucket] = useState<AgeBucketFilter>('all');
    const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubA = onSnapshot(
            query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000)),
            (snap) => {
                setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
                setLoading(false);
            }
        );
        const unsubP = onSnapshot(collection(db, 'patients'), (snap) => {
            const map: Record<string, DentrixPatientDoc> = {};
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
                map[String(row.patient_id ?? row.id)] = row;
            });
            setPatientsById(map);
        });
        return () => {
            unsubA();
            unsubP();
        };
    }, []);

    const queueRows = useMemo(
        () => buildQueueRows(activeId, appointments, patientsById, 0, new Date(), ageBucket),
        [activeId, appointments, patientsById, ageBucket]
    );

    const activeDef = FRONT_DESK_QUEUE_DEFS.find((d) => d.id === activeId)!;
    const showAgeFilter = activeId !== 'no_shows_past_week';

    return (
        <div className="flex flex-col md:flex-row min-h-[calc(100vh-3rem)] bg-slate-50/80 font-sans">
            <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-white p-3 overflow-y-auto max-h-[36vh] md:max-h-none">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">Queues</p>
                <nav className="space-y-0.5">
                    {FRONT_DESK_QUEUE_DEFS.map((q) => (
                        <button
                            key={q.id}
                            type="button"
                            onClick={() => setActiveId(q.id)}
                            className={cn(
                                'w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors',
                                activeId === q.id ? 'bg-teal-50 text-teal-800 border border-teal-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                            )}
                        >
                            {q.label}
                        </button>
                    ))}
                </nav>
            </aside>
            <main className="flex-1 p-4 md:p-6 overflow-auto">
                <div className="mb-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">{activeDef.label}</h1>
                        <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">{activeDef.description}</p>
                    </div>
                    {showAgeFilter && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Last visit</span>
                            {AGE_OPTIONS.map((o) => (
                                <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => setAgeBucket(o.id)}
                                    className={cn(
                                        'px-2.5 py-1 rounded-md text-[9px] font-bold uppercase border',
                                        ageBucket === o.id
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                                    )}
                                >
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className="p-24 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Loading…</div>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm min-w-[720px]">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    <th className="p-3 pl-4">
                                        Patient
                                        <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                                            Tap row name for phone and notes
                                        </span>
                                    </th>
                                    <th className="p-3">Detail</th>
                                    <th className="p-3">Last appt</th>
                                    {activeId === 'no_shows_past_week' ? (
                                        <th className="p-3 pr-4">Rebooked?</th>
                                    ) : (
                                        <>
                                            <th className="p-3">Mo ago</th>
                                            <th className="p-3 pr-4">Provider</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {queueRows.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={activeId === 'no_shows_past_week' ? 4 : 5}
                                            className="p-12 text-center text-xs text-slate-400 font-bold uppercase tracking-widest"
                                        >
                                            No rows for this queue / filter
                                        </td>
                                    </tr>
                                ) : (
                                    queueRows.map((row) => (
                                        <tr key={row.id} className="hover:bg-slate-50/80">
                                            <td className="p-3 pl-4 font-bold text-slate-900">
                                                <PatientProfileTrigger patientId={row.patientId} className="font-bold">
                                                    {row.patientName}
                                                </PatientProfileTrigger>
                                            </td>
                                            <td className="p-3 text-slate-600 text-xs">{row.detail}</td>
                                            <td className="p-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">{row.dateLabel ?? '—'}</td>
                                            {activeId === 'no_shows_past_week' ? (
                                                <td className="p-3 pr-4">
                                                    <span
                                                        className={cn(
                                                            'text-[10px] font-black uppercase px-2 py-1 rounded',
                                                            row.rebooked ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                                        )}
                                                    >
                                                        {row.rebooked ? 'Rebooked' : 'Not rebooked'}
                                                    </span>
                                                </td>
                                            ) : (
                                                <>
                                                    <td className="p-3 text-xs text-slate-600 tabular-nums">
                                                        {row.monthsSince != null ? `${row.monthsSince} mo` : '—'}
                                                    </td>
                                                    <td className="p-3 pr-4 text-xs text-slate-500">{row.provider ?? '—'}</td>
                                                </>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
};

export default FrontDeskQueuesPage;
