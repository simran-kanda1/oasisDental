import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { format, startOfWeek, addDays, endOfDay, parseISO, isValid } from 'date-fns';
import { cn } from '../lib/utils';
import { Activity, AlertTriangle, Calendar, ListTodo, MessageSquare, PhoneCall } from 'lucide-react';
import type { DentrixAppointmentDoc, DentrixPatientAppointmentInfoDoc, DentrixPatientDoc } from '../lib/dentrix';
import {
    cleanDentrixText,
    formatDentrixDateKey,
    formatDentrixTimeLabel,
    formatPatientFullName,
    isActiveDentrixPatient,
    parseDentrixDate,
} from '../lib/dentrix';
import { isRecallFollowUpDoc, isOpenOutreachItem } from '../lib/followUpQueues';
import { ACTIVITY_SECTION_RECALL_QUEUE, ACTIVITY_SECTION_FOLLOW_UP_OUTREACH } from '../lib/activityLogger';
import { navigateToSection } from '../lib/navigation';
import { NO_APPT_BOOKED_QUEUE_ID } from '../data/queueRules';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import { StatGridSkeleton, TableRowsSkeleton } from '../components/ui/skeleton';

const DashboardPage: React.FC = () => {
    const { user } = useAuth();
    const [counts, setCounts] = useState({
        appointmentsToday: 0,
        appointmentsThisWeek: 0,
        openInquiries: 0,
        pendingRecallQueue: 0,
        pendingOutreachQueue: 0,
        overdueRecalls: 0,
        highRiskPatients: 0,
        tasksRemaining: 0
    });
    const [todayAppointments, setTodayAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [apptInfoRows, setApptInfoRows] = useState<DentrixPatientAppointmentInfoDoc[]>([]);
    const [patientsByKey, setPatientsByKey] = useState<Record<string, DentrixPatientDoc>>({});
    const [quality, setQuality] = useState({
        missingContactPatients: 0,
        missingProviderAppointments: 0,
    });
    const [kpis, setKpis] = useState({
        callsMadeToday: 0,
        recallsBookedToday: 0,
        inquiryResponseSlaHours: null as number | null,
    });
    const [frontDeskUsers, setFrontDeskUsers] = useState<Array<{ name: string; actions: number }>>([]);
    const [recentActivity, setRecentActivity] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const recallDerived = useMemo(() => {
        const overdue = apptInfoRows.filter((row) => {
            const missed = row.number_of_missed_appointments ?? 0;
            const nextDate = row.next_appointment_date;
            const hasUpcoming = !!parseDentrixDate(nextDate);
            return missed > 0 && !hasUpcoming;
        });
        const activeOverdue = overdue.filter((row) => {
            const k = String(row.patient_id ?? row.id);
            const p = patientsByKey[k];
            if (p && !isActiveDentrixPatient(p)) return false;
            return true;
        });
        activeOverdue.sort((a, b) => (b.number_of_missed_appointments ?? 0) - (a.number_of_missed_appointments ?? 0));
        return { list: activeOverdue.slice(0, 8), count: activeOverdue.length };
    }, [apptInfoRows, patientsByKey]);

    useEffect(() => {
        const now = new Date();
        const todayKey = format(now, 'yyyy-MM-dd');
        const todayStartIso = `${todayKey}T00:00:00Z`;
        const todayEndIso = endOfDay(now).toISOString();
        const weekStart = startOfWeek(now, { weekStartsOn: 1 });
        const weekEndIso = endOfDay(addDays(weekStart, 5)).toISOString();
        const weekStartIso = `${format(weekStart, 'yyyy-MM-dd')}T00:00:00Z`;

        const unsubTodayAppts = onSnapshot(
            query(
                collection(db, 'appointments'),
                where('appointment_date', '>=', todayStartIso),
                where('appointment_date', '<=', todayEndIso),
                orderBy('appointment_date', 'asc')
            ),
            (snap) => {
                const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc));
                rows.sort((a, b) => {
                    const hourDiff = (a.start_hour ?? 0) - (b.start_hour ?? 0);
                    if (hourDiff !== 0) return hourDiff;
                    return (a.start_minute ?? 0) - (b.start_minute ?? 0);
                });
                setTodayAppointments(rows.slice(0, 8));
                setCounts(prev => ({ ...prev, appointmentsToday: rows.length }));
            }
        );

        const unsubWeekAppts = onSnapshot(
            query(
                collection(db, 'appointments'),
                where('appointment_date', '>=', weekStartIso),
                where('appointment_date', '<=', weekEndIso),
                orderBy('appointment_date', 'asc')
            ),
            (snap) => {
                setCounts(prev => ({ ...prev, appointmentsThisWeek: snap.size }));
                const missingProvider = snap.docs.filter((d) => !String(d.data().provider_id ?? '').trim()).length;
                setQuality(prev => ({ ...prev, missingProviderAppointments: missingProvider }));
            }
        );

        const unsubInq = onSnapshot(collection(db, 'wixInquiries'), (snap) => {
            const openCount = snap.docs.filter((d) => isOpenWixInquiryDoc(d.data() as Record<string, unknown>)).length;
            const completedRows = snap.docs
                .map((d) => d.data())
                .filter((row) => {
                    const r = row as Record<string, unknown>;
                    if (r.phoneMatchExcluded === true) return false;
                    const status = String(row.status ?? '').toLowerCase();
                    return status === 'responded' || status === 'converted' || status === 'closed';
                })
                .map((row) => {
                    const submitted = typeof row.submittedAt === 'string' ? parseISO(row.submittedAt) : null;
                    const lastChanged = typeof row.lastChanged === 'string' ? parseISO(row.lastChanged) : null;
                    if (!submitted || !lastChanged || !isValid(submitted) || !isValid(lastChanged)) return null;
                    const hours = (lastChanged.getTime() - submitted.getTime()) / (1000 * 60 * 60);
                    return hours >= 0 ? hours : null;
                })
                .filter((v): v is number => typeof v === 'number');
            const inquiryResponseSlaHours = completedRows.length
                ? Number((completedRows.reduce((sum, v) => sum + v, 0) / completedRows.length).toFixed(1))
                : null;
            setCounts(prev => ({ ...prev, openInquiries: openCount }));
            setKpis(prev => ({ ...prev, inquiryResponseSlaHours }));
        });

        const unsubFU = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', false)), (snap) => {
            let recall = 0;
            let outreach = 0;
            snap.docs.forEach((d) => {
                const data = d.data() as Record<string, unknown>;
                if (isOpenOutreachItem(data)) outreach += 1;
                else if (isRecallFollowUpDoc(data)) recall += 1;
            });
            setCounts((prev) => ({ ...prev, pendingRecallQueue: recall, pendingOutreachQueue: outreach }));
        });

        const unsubBookedFU = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', true)), (snap) => {
            const recallsBookedToday = snap.docs.filter((d) => {
                const data = d.data() as Record<string, unknown>;
                if (!isRecallFollowUpDoc(data)) return false;
                const changed = String(d.data().lastChanged ?? '');
                if (!changed) return false;
                const parsed = parseISO(changed);
                return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === todayKey;
            }).length;
            setKpis(prev => ({ ...prev, recallsBookedToday }));
        });

        const unsubPatientApptInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc));
            setApptInfoRows(rows);
        });

        const unsubPatients = onSnapshot(collection(db, 'patients'), (snap) => {
            const map: Record<string, DentrixPatientDoc> = {};
            let highRisk = 0;
            let missingContact = 0;
            snap.docs.forEach((d) => {
                const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
                map[String(row.patient_id ?? row.id)] = row;
                if (!isActiveDentrixPatient(row)) return;
                const missed = Number(row.num_of_missed_appointments ?? 0);
                if (missed >= 2) highRisk += 1;
                const mobile = String(row.mobile_phone ?? '').trim();
                const home = String(row.home_phone ?? '').trim();
                if (!mobile && !home) missingContact += 1;
            });
            setPatientsByKey(map);
            setCounts(prev => ({ ...prev, highRiskPatients: highRisk }));
            setQuality(prev => ({ ...prev, missingContactPatients: missingContact }));
        });

        const unsubLogs = onSnapshot(query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(10)), (snap) => {
            setRecentActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        });

        const unsubKpiLogs = onSnapshot(query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(250)), (snap) => {
            const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            const todayLogs = logs.filter((log) => {
                if (!log.timestamp?.toDate) return false;
                return format(log.timestamp.toDate(), 'yyyy-MM-dd') === todayKey;
            });

            const callsMadeToday = todayLogs.filter((log) => {
                const sec = String(log.section ?? '');
                if (sec !== ACTIVITY_SECTION_RECALL_QUEUE && sec !== ACTIVITY_SECTION_FOLLOW_UP_OUTREACH) return false;
                const action = String(log.action ?? '').toLowerCase();
                return action.includes('outreach logged');
            }).length;

            const byUser = new Map<string, number>();
            todayLogs.forEach((log) => {
                const name = String(log.userName ?? '').trim() || 'Unknown';
                byUser.set(name, (byUser.get(name) ?? 0) + 1);
            });
            const leaders = Array.from(byUser.entries())
                .map(([name, actions]) => ({ name, actions }))
                .sort((a, b) => b.actions - a.actions)
                .slice(0, 4);

            setFrontDeskUsers(leaders);
            setKpis((prev) => ({ ...prev, callsMadeToday }));
        });

        const unsubTasks = onSnapshot(collection(db, 'tasks'), (snap) => {
            const allTasks = snap.docs.map(d => d.data());
            const myDirectivesPending = allTasks.filter(t => t.type === 'directive' && t.assignedTo === user?.email && t.status !== 'completed').length;
            const protocolPending = allTasks.filter(t => t.type === 'protocol' && t.date === todayKey && t.status !== 'completed').length;
            setCounts(prev => ({ ...prev, tasksRemaining: myDirectivesPending + protocolPending }));
        });

        return () => {
            unsubTodayAppts();
            unsubWeekAppts();
            unsubInq();
            unsubFU();
            unsubBookedFU();
            unsubPatientApptInfo();
            unsubPatients();
            unsubLogs();
            unsubKpiLogs();
            unsubTasks();
        };
    }, [user?.email]);

    useEffect(() => {
        setCounts((prev) => ({ ...prev, overdueRecalls: recallDerived.count }));
    }, [recallDerived.count]);

    const stats: Array<{
        label: string;
        value: number;
        icon: typeof Calendar;
        color: string;
        border: string;
        onClick?: () => void;
    }> = [
        { label: 'Today Appointments', value: counts.appointmentsToday, icon: Calendar, color: 'text-teal-600', border: 'border-teal-200', onClick: () => navigateToSection('appointments') },
        { label: 'Week Appointments', value: counts.appointmentsThisWeek, icon: Calendar, color: 'text-blue-600', border: 'border-blue-200', onClick: () => navigateToSection('appointments') },
        { label: 'Open Inquiries', value: counts.openInquiries, icon: MessageSquare, color: 'text-indigo-600', border: 'border-indigo-200', onClick: () => navigateToSection('inquiries') },
        { label: 'No future appointments', value: counts.pendingRecallQueue, icon: PhoneCall, color: 'text-amber-600', border: 'border-amber-200', onClick: () => navigateToSection('frontDeskQueues', NO_APPT_BOOKED_QUEUE_ID) },
        { label: 'Estimate follow-up', value: counts.pendingOutreachQueue, icon: PhoneCall, color: 'text-orange-600', border: 'border-orange-200', onClick: () => navigateToSection('followUpOutreach') },
        { label: 'Overdue Recalls', value: counts.overdueRecalls, icon: AlertTriangle, color: 'text-rose-600', border: 'border-rose-200', onClick: () => navigateToSection('frontDeskQueues', NO_APPT_BOOKED_QUEUE_ID) },
        { label: 'High-Risk Patients', value: counts.highRiskPatients, icon: AlertTriangle, color: 'text-fuchsia-600', border: 'border-fuchsia-200', onClick: () => navigateToSection('frontDeskQueues', NO_APPT_BOOKED_QUEUE_ID) },
        { label: 'Checklist', value: counts.tasksRemaining, icon: ListTodo, color: 'text-slate-600', border: 'border-slate-300', onClick: () => navigateToSection('staffTasks') },
    ];

    return (
        <div className="p-4 space-y-4 max-w-full mx-auto bg-[#f1f5f9] min-h-screen font-sans">
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight">Oasis Dental Dashboard</h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Clinical Operations Real-time Signal</p>
                </div>
                <div className="bg-teal-50 px-3 py-1.5 rounded border border-teal-100 text-[10px] font-bold text-teal-600 uppercase tracking-tight">
                    System Hub Active
                </div>
            </div>

            {loading ? (
                <StatGridSkeleton count={8} />
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {stats.map((stat, i) => {
                    const Icon = stat.icon;
                    const Wrapper = stat.onClick ? 'button' : 'div';
                    return (
                        <Wrapper
                            key={i}
                            type={stat.onClick ? 'button' : undefined}
                            onClick={stat.onClick}
                            className={cn(
                                "bg-white border p-4 rounded-md shadow-sm flex items-center gap-4 transition-all text-left w-full",
                                stat.border,
                                stat.onClick && "hover:shadow-md hover:border-teal-300 cursor-pointer"
                            )}
                        >
                            <div className={cn("w-10 h-10 rounded bg-slate-50 flex items-center justify-center shrink-0", stat.color)}>
                                <Icon size={20} />
                            </div>
                            <div>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">{stat.label}</p>
                                <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight leading-none">{stat.value}</p>
                            </div>
                        </Wrapper>
                    );
                })}
            </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-md p-4">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Calls Made Today</p>
                    <p className="text-2xl font-bold text-teal-700 mt-2">{kpis.callsMadeToday}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-md p-4">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Recalls Booked Today</p>
                    <p className="text-2xl font-bold text-emerald-700 mt-2">{kpis.recallsBookedToday}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-md p-4">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Inquiry Response SLA</p>
                    <p className="text-2xl font-bold text-indigo-700 mt-2">
                        {kpis.inquiryResponseSlaHours === null ? 'N/A' : `${kpis.inquiryResponseSlaHours}h`}
                    </p>
                </div>
            </div>

            {/* Operational Snapshot */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-white border border-slate-200 rounded-md overflow-hidden xl:col-span-2">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            Today Queue
                            <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                                Tap patient for contact card
                            </span>
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto scrollbar-none">
                        {todayAppointments.length === 0 ? (
                            <div className="text-center p-10 opacity-30 text-[10px] uppercase font-bold tracking-widest">No appointments found for today</div>
                        ) : (
                            todayAppointments.map((appt) => {
                                const date = formatDentrixDateKey(appt.appointment_date);
                                return (
                                    <div key={appt.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                                        <div className="min-w-0">
                                            <PatientProfileTrigger patientId={appt.patient_id != null ? String(appt.patient_id) : null}>
                                                <p className="text-[11px] font-bold text-slate-800 uppercase truncate">
                                                    {cleanDentrixText(appt.patient_name) || 'Unknown Patient'}
                                                </p>
                                            </PatientProfileTrigger>
                                            <p className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                                                {cleanDentrixText(appt.reason) || 'General'} • {cleanDentrixText(appt.provider_id) || 'Unassigned'}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest">
                                                {formatDentrixTimeLabel(appt.start_hour, appt.start_minute)}
                                            </p>
                                            <p className="text-[9px] text-slate-400">{date ?? 'N/A'}</p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            Recall Attention Queue
                            <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                                Tap patient for contact card
                            </span>
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto scrollbar-none">
                        {recallDerived.list.length === 0 ? (
                            <div className="text-center p-10 opacity-30 text-[10px] uppercase font-bold tracking-widest">No overdue recalls detected</div>
                        ) : (
                            recallDerived.list.map((row) => (
                                <div key={row.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                                    <div className="min-w-0">
                                        <PatientProfileTrigger patientId={row.patient_id != null ? String(row.patient_id) : row.id}>
                                            <p className="text-[11px] font-bold text-slate-800 uppercase truncate">
                                                {formatPatientFullName(row.first_name, row.last_name) || `Patient #${row.patient_id ?? row.id}`}
                                            </p>
                                        </PatientProfileTrigger>
                                        <p className="text-[9px] text-slate-500 uppercase tracking-wide truncate">
                                            Last visit: {formatDentrixDateKey(row.previous_appointment_date) ?? 'Unknown'}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">
                                            {row.number_of_missed_appointments ?? 0} missed
                                        </p>
                                        <p className="text-[9px] text-slate-400">
                                            Last missed: {formatDentrixDateKey(row.last_missed_appointment_date) ?? 'N/A'}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Activity Log */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-md overflow-hidden xl:col-span-2">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <Activity size={14} className="text-teal-600" />
                            Recent Activity Log
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto scrollbar-none">
                        {loading ? (
                            <TableRowsSkeleton rows={5} />
                        ) : recentActivity.length === 0 ? (
                            <div className="text-center p-12 opacity-30 text-[10px] uppercase font-bold tracking-widest">No Signals Recorded</div>
                        ) : (
                            recentActivity.map((log, i) => (
                                <div key={i} className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-bold text-slate-800 leading-tight uppercase tracking-tight truncate">{log.action}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter shrink-0">{log.userName}</span>
                                            <span className="text-[9px] font-bold text-slate-200">•</span>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter shrink-0">{log.section || 'General'}</span>
                                        </div>
                                    </div>
                                    <div className="text-[9px] font-bold text-teal-600/50 uppercase tracking-tighter whitespace-nowrap">
                                        {log.timestamp?.toDate ? format(log.timestamp.toDate(), 'h:mm a') : 'Just Now'}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-md overflow-hidden xl:col-span-1">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Data Quality Alerts</h3>
                    </div>
                    <div className="p-4 space-y-3">
                        <div className="p-3 rounded border border-amber-200 bg-amber-50">
                            <p className="text-[9px] font-bold text-amber-700 uppercase tracking-widest">Patients Missing Contact</p>
                            <p className="text-xl font-bold text-amber-800 mt-1">{quality.missingContactPatients}</p>
                        </div>
                        <div className="p-3 rounded border border-rose-200 bg-rose-50">
                            <p className="text-[9px] font-bold text-rose-700 uppercase tracking-widest">Appointments Missing Provider (Week)</p>
                            <p className="text-xl font-bold text-rose-800 mt-1">{quality.missingProviderAppointments}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Front Desk Next Best Actions</h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    <button
                        onClick={() => navigateToSection('staffTasks')}
                        className="p-3 rounded border border-slate-200 bg-slate-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Checklist Priority</p>
                        <p className="text-sm font-bold text-slate-900 mt-1">{counts.tasksRemaining} items pending</p>
                    </button>
                    <button
                        onClick={() => navigateToSection('frontDeskQueues', NO_APPT_BOOKED_QUEUE_ID)}
                        className="p-3 rounded border border-amber-200 bg-amber-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">No appt booked</p>
                        <p className="text-sm font-bold text-amber-900 mt-1">{counts.pendingRecallQueue} open</p>
                    </button>
                    <button
                        onClick={() => navigateToSection('followUpOutreach')}
                        className="p-3 rounded border border-orange-200 bg-orange-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-orange-600 uppercase tracking-widest">Estimate follow-up</p>
                        <p className="text-sm font-bold text-orange-900 mt-1">{counts.pendingOutreachQueue} open</p>
                    </button>
                    <button
                        onClick={() => navigateToSection('inquiries')}
                        className="p-3 rounded border border-indigo-200 bg-indigo-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest">Website Leads</p>
                        <p className="text-sm font-bold text-indigo-900 mt-1">{counts.openInquiries} inquiries need response</p>
                    </button>
                    <button
                        onClick={() => navigateToSection('appointments')}
                        className="p-3 rounded border border-teal-200 bg-teal-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-teal-600 uppercase tracking-widest">Schedule Coverage</p>
                        <p className="text-sm font-bold text-teal-900 mt-1">{counts.appointmentsToday} patients booked today</p>
                    </button>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Live Front Desk Activity (Today)</h3>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    {frontDeskUsers.length === 0 ? (
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No tracked activity yet today.</div>
                    ) : (
                        frontDeskUsers.map((userRow) => (
                            <div key={userRow.name} className="p-3 rounded border border-slate-200 bg-slate-50">
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest truncate">{userRow.name}</p>
                                <p className="text-xl font-bold text-slate-900 mt-1">{userRow.actions}</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">actions today</p>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default DashboardPage;
