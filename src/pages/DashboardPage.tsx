import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { format, startOfWeek, addDays, endOfDay, parseISO, isValid } from 'date-fns';
import { cn } from '../lib/utils';
import { Activity, AlertTriangle, Calendar, ListTodo, MessageSquare, PhoneCall } from 'lucide-react';
import type { DentrixAppointmentDoc, DentrixPatientAppointmentInfoDoc } from '../lib/dentrix';
import { cleanDentrixText, formatDentrixDateKey, formatDentrixTimeLabel, formatPatientFullName, parseDentrixDate } from '../lib/dentrix';
import { navigateToSection } from '../lib/navigation';

const DashboardPage: React.FC = () => {
    const { user } = useAuth();
    const [counts, setCounts] = useState({
        appointmentsToday: 0,
        appointmentsThisWeek: 0,
        openInquiries: 0,
        pendingFollowups: 0,
        overdueRecalls: 0,
        highRiskPatients: 0,
        tasksRemaining: 0
    });
    const [todayAppointments, setTodayAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [recallPatients, setRecallPatients] = useState<DentrixPatientAppointmentInfoDoc[]>([]);
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
            const openCount = snap.docs.filter((d) => {
                const status = String(d.data().status ?? '').toLowerCase();
                return status !== 'converted';
            }).length;
            const completedRows = snap.docs
                .map((d) => d.data())
                .filter((row) => {
                    const status = String(row.status ?? '').toLowerCase();
                    return status === 'responded' || status === 'converted';
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
            setCounts(prev => ({ ...prev, pendingFollowups: snap.size }));
        });

        const unsubBookedFU = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', true)), (snap) => {
            const recallsBookedToday = snap.docs.filter((d) => {
                const changed = String(d.data().lastChanged ?? '');
                if (!changed) return false;
                const parsed = parseISO(changed);
                return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === todayKey;
            }).length;
            setKpis(prev => ({ ...prev, recallsBookedToday }));
        });

        const unsubPatientApptInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc));
            const overdue = rows.filter((row) => {
                const missed = row.number_of_missed_appointments ?? 0;
                const nextDate = row.next_appointment_date;
                const hasUpcoming = !!parseDentrixDate(nextDate);
                return missed > 0 && !hasUpcoming;
            });
            overdue.sort((a, b) => (b.number_of_missed_appointments ?? 0) - (a.number_of_missed_appointments ?? 0));
            setRecallPatients(overdue.slice(0, 8));
            setCounts(prev => ({ ...prev, overdueRecalls: overdue.length }));
        });

        const unsubPatients = onSnapshot(collection(db, 'patients'), (snap) => {
            const highRisk = snap.docs.filter((d) => {
                const missed = Number(d.data().num_of_missed_appointments ?? 0);
                return missed >= 2;
            }).length;
            const missingContact = snap.docs.filter((d) => {
                const mobile = String(d.data().mobile_phone ?? '').trim();
                const home = String(d.data().home_phone ?? '').trim();
                return !mobile && !home;
            }).length;
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
                const action = String(log.action ?? '');
                return String(log.section ?? '') === 'Follow-Ups' && action.toLowerCase().startsWith('follow-up call');
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

    const stats = [
        { label: 'Today Appointments', value: counts.appointmentsToday, icon: Calendar, color: 'text-teal-600', border: 'border-teal-200' },
        { label: 'Week Appointments', value: counts.appointmentsThisWeek, icon: Calendar, color: 'text-blue-600', border: 'border-blue-200' },
        { label: 'Open Inquiries', value: counts.openInquiries, icon: MessageSquare, color: 'text-indigo-600', border: 'border-indigo-200' },
        { label: 'Follow-Ups', value: counts.pendingFollowups, icon: PhoneCall, color: 'text-amber-600', border: 'border-amber-200' },
        { label: 'Overdue Recalls', value: counts.overdueRecalls, icon: AlertTriangle, color: 'text-rose-600', border: 'border-rose-200' },
        { label: 'High-Risk Patients', value: counts.highRiskPatients, icon: AlertTriangle, color: 'text-fuchsia-600', border: 'border-fuchsia-200' },
        { label: 'Checklist', value: counts.tasksRemaining, icon: ListTodo, color: 'text-slate-600', border: 'border-slate-300' },
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

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {stats.map((stat, i) => {
                    const Icon = stat.icon;
                    return (
                        <div key={i} className={cn("bg-white border p-4 rounded-md shadow-sm flex items-center gap-4 transition-all hover:shadow-md", stat.border)}>
                            <div className={cn("w-10 h-10 rounded bg-slate-50 flex items-center justify-center shrink-0", stat.color)}>
                                <Icon size={20} />
                            </div>
                            <div>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">{stat.label}</p>
                                <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight leading-none">{stat.value}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

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
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Today Queue</h3>
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
                                            <p className="text-[11px] font-bold text-slate-800 uppercase truncate">
                                                {cleanDentrixText(appt.patient_name) || 'Unknown Patient'}
                                            </p>
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
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recall Attention Queue</h3>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto scrollbar-none">
                        {recallPatients.length === 0 ? (
                            <div className="text-center p-10 opacity-30 text-[10px] uppercase font-bold tracking-widest">No overdue recalls detected</div>
                        ) : (
                            recallPatients.map((row) => (
                                <div key={row.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-bold text-slate-800 uppercase truncate">
                                            {formatPatientFullName(row.first_name, row.last_name) || `Patient #${row.patient_id ?? row.id}`}
                                        </p>
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
                            <div className="text-center p-12 opacity-30 text-[10px] uppercase font-bold tracking-[0.3em]">Syncing Registry...</div>
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
                <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    <button
                        onClick={() => navigateToSection('staffTasks')}
                        className="p-3 rounded border border-slate-200 bg-slate-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Checklist Priority</p>
                        <p className="text-sm font-bold text-slate-900 mt-1">{counts.tasksRemaining} items pending</p>
                    </button>
                    <button
                        onClick={() => navigateToSection('followups')}
                        className="p-3 rounded border border-amber-200 bg-amber-50 hover:bg-white text-left transition-colors"
                    >
                        <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Call Queue</p>
                        <p className="text-sm font-bold text-amber-900 mt-1">{counts.pendingFollowups} follow-ups open</p>
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
