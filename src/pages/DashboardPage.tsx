import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Card, CardContent } from '../components/ui/card';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { Activity, Calendar, MessageSquare, PhoneCall, ListTodo } from 'lucide-react';

const DashboardPage: React.FC = () => {
    const { user } = useAuth();
    const [counts, setCounts] = useState({
        appointments: 0,
        inquiries: 0,
        followups: 0,
        tasksRemaining: 0
    });
    const [recentActivity, setRecentActivity] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const dayOfWeek = new Date().getDay();
        const activeDay = dayOfWeek === 0 ? 1 : (dayOfWeek > 5 ? 5 : dayOfWeek);
        const dayOfMonth = new Date().getDate();
        const activeWeek = Math.min(4, Math.ceil(dayOfMonth / 7));

        let totalProtocols = 0;
        const unsubProtocols = onSnapshot(query(collection(db, 'recurringTaskSchedule'), where('week', '==', activeWeek), where('day', '==', activeDay)), (snap) => {
            totalProtocols = snap.size;
        });

        const unsubAppts = onSnapshot(query(collection(db, 'appointments'), where('date', '==', todayStr)), (snap) => {
            setCounts(prev => ({ ...prev, appointments: snap.size }));
        });

        const unsubInq = onSnapshot(query(collection(db, 'wixInquiries'), where('status', '==', 'pending')), (snap) => {
            setCounts(prev => ({ ...prev, inquiries: snap.size }));
        });

        const unsubFU = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', false)), (snap) => {
            setCounts(prev => ({ ...prev, followups: snap.size }));
        });

        const unsubLogs = onSnapshot(query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(10)), (snap) => {
            setRecentActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        });

        const unsubTasks = onSnapshot(query(collection(db, 'tasks')), (snap) => {
            const allTasks = snap.docs.map(d => d.data());
            const myDirectivesPending = allTasks.filter(t => t.type === 'directive' && t.assignedTo === user?.email && t.status !== 'completed').length;
            const completedProtocols = allTasks.filter(t => t.type === 'protocol' && t.date === todayStr && t.status === 'completed').length;
            const protocolsRemaining = Math.max(0, totalProtocols - completedProtocols);
            setCounts(prev => ({ ...prev, tasksRemaining: myDirectivesPending + protocolsRemaining }));
        });

        return () => {
            unsubProtocols();
            unsubAppts();
            unsubInq();
            unsubFU();
            unsubLogs();
            unsubTasks();
        };
    }, [user?.email]);

    const stats = [
        { label: 'Appointments', value: counts.appointments, icon: Calendar, color: 'text-teal-600', border: 'border-teal-200' },
        { label: 'New Inquiries', value: counts.inquiries, icon: MessageSquare, color: 'text-blue-600', border: 'border-blue-200' },
        { label: 'Follow-Ups', value: counts.followups, icon: PhoneCall, color: 'text-amber-600', border: 'border-amber-200' },
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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

            {/* Activity Log */}
            <div className="grid grid-cols-1 gap-4">
                <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
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
            </div>
        </div>
    );
};

export default DashboardPage;
