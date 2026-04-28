import React, { useState, useEffect } from 'react';
import {
    collection, addDoc, getDocs, updateDoc, doc, deleteDoc, setDoc,
    serverTimestamp, query, orderBy, onSnapshot, where
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { type RecurringTask } from '../data/tasksSchedule';
import { isActiveDentrixPatient } from '../lib/dentrix';
import { isRecallFollowUpDoc, isOpenOutreachItem } from '../lib/followUpQueues';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import { deriveTaskGroupFromTitle } from '../lib/taskGroups';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { format } from 'date-fns';
import { cn } from '../lib/utils';

interface Task {
    id: string;
    type: 'protocol' | 'directive';
    title: string;
    description?: string;
    assignedTo: string;
    assignedToName?: string;
    assignedBy: string;
    assignedByName?: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    dueDate?: string;
    completedAt?: any;
    completedBy?: string;
    completedByName?: string;
    createdAt?: any;
    date?: string;
    taskId?: string;
    notes?: string;
}

const TaskCard: React.FC<{
    task: Task;
    onStatusChange: (id: string, status: Task['status']) => void;
    onDelete: (id: string) => void;
    isAdmin: boolean;
}> = ({ task, onStatusChange, onDelete, isAdmin }) => {
    const nextStatus: Record<Task['status'], Task['status']> = {
        pending: 'in_progress',
        in_progress: 'completed',
        completed: 'pending',
    };

    const assignedAt = task.createdAt?.toDate ? format(task.createdAt.toDate(), 'MMM d, h:mm a') : 'Recently';

    return (
        <Card className={cn(
            "bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden p-6 space-y-6 hover:border-teal-300 transition-all group",
            task.status === 'completed' && "opacity-40"
        )}>
            <div className="flex justify-between items-start gap-3">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => onStatusChange(task.id, nextStatus[task.status])}
                        className={cn("w-6 h-6 rounded-lg border-2 border-slate-200 shrink-0 flex items-center justify-center transition-all", task.status === 'completed' ? "bg-teal-600 border-teal-600 shadow-xl shadow-teal-500/20" : "hover:border-teal-500")}
                    >
                        {task.status === 'completed' && <div className="w-2 h-2 bg-white rounded-sm" />}
                    </button>
                    <p className={cn("text-xs font-black uppercase tracking-tighter text-slate-900 leading-tight", task.status === 'completed' && "line-through text-slate-400")}>
                        {task.title}
                    </p>
                </div>
                {isAdmin && (
                    <button onClick={() => onDelete(task.id)} className="text-[9px] font-black text-slate-300 hover:text-rose-600 uppercase tracking-widest transition-colors opacity-0 group-hover:opacity-100">Delete</button>
                )}
            </div>

            <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] pt-4 border-t border-slate-50">
                <span className="text-teal-600/60 truncate mr-4">{task.assignedToName || task.assignedTo.split('@')[0]}</span>
                <span className="shrink-0">{assignedAt}</span>
            </div>

            {task.notes && (
                <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-100 italic">
                    <p className="text-[11px] text-slate-500 leading-tight uppercase font-black tracking-tighter opacity-70">"{task.notes}"</p>
                </div>
            )}
        </Card>
    );
};

const AdminPortalPage: React.FC = () => {
    const { user, userProfile, isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState<'tasks' | 'checklist' | 'activity' | 'users' | 'operations'>('tasks');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [recurringSchedule, setRecurringSchedule] = useState<RecurringTask[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [showAddTask, setShowAddTask] = useState(false);
    const [showAddRecurring, setShowAddRecurring] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeWeek, setActiveWeek] = useState(1);
    const [newRecurring, setNewRecurring] = useState({ title: '', week: 1, day: 1 });
    const [opsStats, setOpsStats] = useState({
        appointments: 0,
        patients: 0,
        activePatients: 0,
        pendingRecallQueue: 0,
        pendingOutreachQueue: 0,
        openInquiries: 0
    });
    const [lastSyncedAt, setLastSyncedAt] = useState<string>('N/A');
    const [qualityStats, setQualityStats] = useState({
        patientsMissingPhone: 0,
        patientsMissingEmail: 0,
        appointmentsMissingProvider: 0,
        stalePatientSyncRecords: 0,
    });

    useEffect(() => {
        const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, snap => {
            setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
            setLoading(false);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const q = query(collection(db, 'recurringTaskSchedule'));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
            data.sort((a, b) => (a.week || 0) - (b.week || 0) || (a.day || 0) - (b.day || 0));
            setRecurringSchedule(data);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const fetchUsers = async () => {
            const snap = await getDocs(collection(db, 'users'));
            setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }) as any));
        };
        fetchUsers();
    }, []);

    useEffect(() => {
        const q = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'));
        const unsub = onSnapshot(q, snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        return unsub;
    }, []);

    const handleAddTask = async (t: any) => {
        const assignee = users.find(u => u.email === t.assignedTo);
        await addDoc(collection(db, 'tasks'), {
            ...t,
            type: 'directive',
            status: 'pending',
            assignedToName: assignee?.displayName || t.assignedTo.split('@')[0],
            assignedBy: user?.email,
            assignedByName: userProfile?.displayName || user?.email,
            createdAt: serverTimestamp()
        });
        setShowAddTask(false);
    };

    const handleAddRecurring = async (e: React.FormEvent) => {
        e.preventDefault();
        const id = `rec-${Date.now()}`;
        await setDoc(doc(db, 'recurringTaskSchedule', id), {
            id,
            ...newRecurring,
            taskGroup: deriveTaskGroupFromTitle(newRecurring.title),
        });
        setNewRecurring({ title: '', week: 1, day: 1 });
        setShowAddRecurring(false);
    };

    const handleStatusChange = async (id: string, s: Task['status']) => {
        const updateData: any = { status: s };
        if (s === 'completed') {
            updateData.completedAt = serverTimestamp();
            updateData.completedBy = user?.email;
            updateData.completedByName = userProfile?.displayName || user?.email;
        }
        await updateDoc(doc(db, 'tasks', id), updateData);
    };

    const handleDeleteTask = async (id: string) => {
        await deleteDoc(doc(db, 'tasks', id));
    };

    const handleRemoveRecurring = async (id: string) => {
        if (!confirm('Remove protocol node?')) return;
        await deleteDoc(doc(db, 'recurringTaskSchedule', id));
    };

    useEffect(() => {
        const unsubPatients = onSnapshot(collection(db, 'patients'), (snap) => {
            let active = 0;
            snap.docs.forEach((d) => {
                if (isActiveDentrixPatient(d.data() as { status?: number })) active += 1;
            });
            setOpsStats(prev => ({ ...prev, patients: snap.size, activePatients: active }));
            let missingPhone = 0;
            let missingEmail = 0;
            let staleSync = 0;
            const nowMs = Date.now();
            const latest = snap.docs
                .map((d) => String(d.data().last_synced_at ?? ''))
                .filter(Boolean)
                .sort()
                .at(-1);
            snap.docs.forEach((d) => {
                const data = d.data();
                if (!isActiveDentrixPatient(data as { status?: number })) return;
                const mobile = String(data.mobile_phone ?? '').trim();
                const home = String(data.home_phone ?? '').trim();
                const email = String(data.email ?? '').trim();
                const lastSync = String(data.last_synced_at ?? '').trim();
                if (!mobile && !home) missingPhone += 1;
                if (!email) missingEmail += 1;
                if (lastSync) {
                    const syncMs = Date.parse(lastSync);
                    if (!Number.isNaN(syncMs) && nowMs - syncMs > 1000 * 60 * 60 * 24 * 7) {
                        staleSync += 1;
                    }
                }
            });
            if (latest) setLastSyncedAt(latest);
            setQualityStats(prev => ({
                ...prev,
                patientsMissingPhone: missingPhone,
                patientsMissingEmail: missingEmail,
                stalePatientSyncRecords: staleSync,
            }));
        });

        const unsubAppts = onSnapshot(collection(db, 'appointments'), (snap) => {
            setOpsStats(prev => ({ ...prev, appointments: snap.size }));
            const missingProvider = snap.docs.filter((d) => !String(d.data().provider_id ?? '').trim()).length;
            setQualityStats(prev => ({ ...prev, appointmentsMissingProvider: missingProvider }));
        });

        const unsubFollowUps = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', false)), (snap) => {
            let recall = 0;
            let outreach = 0;
            snap.docs.forEach((d) => {
                const data = d.data() as Record<string, unknown>;
                if (isOpenOutreachItem(data)) outreach += 1;
                else if (isRecallFollowUpDoc(data)) recall += 1;
            });
            setOpsStats(prev => ({ ...prev, pendingRecallQueue: recall, pendingOutreachQueue: outreach }));
        });

        const unsubInquiries = onSnapshot(collection(db, 'wixInquiries'), (snap) => {
            const open = snap.docs.filter((d) => isOpenWixInquiryDoc(d.data() as Record<string, unknown>)).length;
            setOpsStats(prev => ({ ...prev, openInquiries: open }));
        });

        return () => {
            unsubPatients();
            unsubAppts();
            unsubFollowUps();
            unsubInquiries();
        };
    }, []);

    const handleUpdateUserRole = async (uid: string, role: 'admin' | 'staff') => {
        await updateDoc(doc(db, 'users', uid), { role });
    };

    if (!isAdmin) {
        return (
            <div className="p-8 max-w-3xl mx-auto">
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6">
                    <h2 className="text-lg font-black text-rose-700 uppercase tracking-wide">Admin Access Required</h2>
                    <p className="text-sm text-rose-600 mt-2">
                        Your account is currently staff-only. Ask an admin to update your role in the Users tab.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 space-y-12 max-w-full mx-auto bg-white font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Portal</h1>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">Administrative Core</p>
                </div>
                <div className="flex flex-wrap gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100 shadow-sm">
                    {(['tasks', 'checklist', 'activity', 'users', 'operations'] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={cn("px-6 py-2 text-[10px] font-black uppercase tracking-widest leading-none rounded-xl transition-all", activeTab === tab ? "bg-white text-teal-600 shadow-sm border border-slate-100" : "text-slate-400 hover:text-slate-600 hover:bg-white/50")}>
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {loading && activeTab === 'tasks' ? <div className="p-40 text-center opacity-10 uppercase text-[10px] font-black tracking-[0.3em]">Syncing...</div> : null}

            {activeTab === 'operations' && (
                <div className="max-w-md mx-auto py-20 text-center space-y-8 animate-in zoom-in-95 duration-500">
                    <div className="w-20 h-20 bg-teal-50 rounded-[2.5rem] flex items-center justify-center text-teal-600 mx-auto shadow-sm border border-teal-100">
                        <div className="w-3 h-3 rounded-full bg-current animate-pulse" />
                    </div>
                    <div className="space-y-3">
                        <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight leading-none">Live Operations</h3>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest leading-relaxed opacity-60">
                            Dentrix-backed environment health and volume.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-left">
                        <div className="p-4 bg-white rounded-2xl border border-slate-100">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Patients (active)</p>
                            <p className="text-2xl font-black text-slate-900 mt-2">{opsStats.activePatients}</p>
                            <p className="text-[8px] font-bold text-slate-400 mt-1 uppercase">Total in Firestore: {opsStats.patients}</p>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Appointments</p>
                            <p className="text-2xl font-black text-slate-900 mt-2">{opsStats.appointments}</p>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">No appt booked</p>
                            <p className="text-2xl font-black text-slate-900 mt-2">{opsStats.pendingRecallQueue}</p>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Follow-up outreach</p>
                            <p className="text-2xl font-black text-slate-900 mt-2">{opsStats.pendingOutreachQueue}</p>
                        </div>
                        <div className="p-4 bg-white rounded-2xl border border-slate-100">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Open Inquiries</p>
                            <p className="text-2xl font-black text-slate-900 mt-2">{opsStats.openInquiries}</p>
                        </div>
                    </div>
                    <div className="p-4 rounded-2xl border border-teal-100 bg-teal-50/50">
                        <p className="text-[9px] font-black text-teal-700 uppercase tracking-widest">
                            Last Dentrix sync seen
                        </p>
                        <p className="text-[11px] font-black text-teal-900 mt-2 break-all">{lastSyncedAt}</p>
                    </div>
                    <div className="w-full p-4 rounded-2xl border border-slate-100 bg-white text-left space-y-3">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Data Quality Watch</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                                <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Missing Phone</p>
                                <p className="text-xl font-black text-amber-800 mt-1">{qualityStats.patientsMissingPhone}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                                <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Missing Email</p>
                                <p className="text-xl font-black text-amber-800 mt-1">{qualityStats.patientsMissingEmail}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                                <p className="text-[9px] font-black text-rose-700 uppercase tracking-widest">Missing Provider</p>
                                <p className="text-xl font-black text-rose-800 mt-1">{qualityStats.appointmentsMissingProvider}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                                <p className="text-[9px] font-black text-rose-700 uppercase tracking-widest">Stale Sync (&gt;7d)</p>
                                <p className="text-xl font-black text-rose-800 mt-1">{qualityStats.stalePatientSyncRecords}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'checklist' && (
                <div className="space-y-12">
                    <div className="flex justify-between items-center gap-6 px-2">
                        <div className="flex gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-100 shadow-sm">
                            {[1, 2, 3, 4].map(w => (
                                <button key={w} onClick={() => setActiveWeek(w)} className={cn("px-6 py-2 text-[10px] font-black uppercase tracking-widest leading-none rounded-xl transition-all", activeWeek === w ? "bg-white text-slate-900 shadow-sm border border-slate-100" : "text-slate-400 hover:text-slate-600")}>
                                    Week {w}
                                </button>
                            ))}
                        </div>
                        <Button onClick={() => setShowAddRecurring(true)} className="h-11 px-8 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-[0.98]">Add Node</Button>
                    </div>

                    {showAddRecurring && (
                        <Card className="p-8 border-slate-100 rounded-[2rem] shadow-xl animate-in slide-in-from-top-4 duration-300">
                            <form onSubmit={handleAddRecurring} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 opacity-60">Node Title</label>
                                    <Input placeholder="Enter protocol details..." value={newRecurring.title} onChange={e => setNewRecurring({ ...newRecurring, title: e.target.value })} className="h-12 text-sm font-bold border-slate-100 bg-slate-50/50 rounded-2xl focus:bg-white focus:ring-teal-500/10 transition-all" required />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 opacity-60">Week Registry</label>
                                        <select value={newRecurring.week} onChange={e => setNewRecurring({ ...newRecurring, week: parseInt(e.target.value) })} className="w-full h-12 border border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase tracking-tight px-4 focus:bg-white focus:border-teal-300 transition-all outline-none">
                                            {[1, 2, 3, 4].map(w => <option key={w} value={w}>Week {w}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 opacity-60">Day Signal</label>
                                        <select value={newRecurring.day} onChange={e => setNewRecurring({ ...newRecurring, day: parseInt(e.target.value) })} className="w-full h-12 border border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase tracking-tight px-4 focus:bg-white focus:border-teal-300 transition-all outline-none">
                                            {[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>Day {d}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex gap-4 pt-4 border-t border-slate-50">
                                    <Button type="submit" className="flex-1 bg-teal-600 text-white font-black h-12 rounded-2xl shadow-xl shadow-teal-500/10 text-[11px] uppercase tracking-widest active:scale-[0.98] transition-all">Submit Node</Button>
                                    <Button variant="ghost" onClick={() => setShowAddRecurring(false)} className="px-8 h-12 text-slate-400 font-black uppercase text-[10px] tracking-widest rounded-2xl">Cancel</Button>
                                </div>
                            </form>
                        </Card>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        {[1, 2, 3, 4, 5, 6].map(d => (
                            <div key={d} className="space-y-4">
                                <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] pl-2">Day {d}</h4>
                                <Card className="border-slate-100 rounded-[2rem] bg-slate-50/50 overflow-hidden min-h-[400px]">
                                    <CardContent className="p-4 space-y-3">
                                        {recurringSchedule.filter(t => t.day === d && t.week === activeWeek).map(t => (
                                            <div key={t.id} className="group flex justify-between items-center text-[10px] font-black text-slate-600 bg-white p-4 border border-slate-100 rounded-2xl uppercase leading-tight hover:border-teal-300 hover:shadow-xl hover:shadow-teal-500/5 transition-all">
                                                <span className="truncate pr-4">{t.title}</span>
                                                <button onClick={() => handleRemoveRecurring(t.id)} className="opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-600 transition-all text-[8px]">X</button>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'tasks' && !loading && (
                <div className="space-y-12">
                    <div className="flex justify-between items-center border-b pb-6 border-slate-50 px-2">
                        <h3 className="text-[11px] font-black text-slate-300 uppercase tracking-[0.3em]">Direct Assignments</h3>
                        <Button onClick={() => setShowAddTask(true)} className="h-11 px-8 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-[0.98]">Add Node</Button>
                    </div>

                    {showAddTask && (
                        <Card className="p-10 border-slate-100 rounded-[2.5rem] shadow-xl animate-in slide-in-from-top-4 duration-300">
                            <form onSubmit={(e) => {
                                e.preventDefault();
                                const formData = new FormData(e.currentTarget);
                                handleAddTask({
                                    title: formData.get('title') as string,
                                    assignedTo: formData.get('assignedTo') as string,
                                    priority: formData.get('priority') as any,
                                });
                            }} className="space-y-8">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 opacity-60">Protocol Detail</label>
                                    <Input name="title" placeholder="Protocol instructions..." required className="h-14 text-sm font-bold border-slate-100 bg-slate-50/50 rounded-2xl focus:bg-white focus:ring-teal-500/10 shadow-sm transition-all" />
                                </div>
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 opacity-60">Staff Registry</label>
                                        <select name="assignedTo" className="w-full h-14 border border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase tracking-tight px-6 focus:bg-white focus:border-teal-300 transition-all outline-none">
                                            {users.map(u => <option key={u.email} value={u.email}>{u.displayName}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 opacity-60">Priority Signal</label>
                                        <select name="priority" className="w-full h-14 border border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase tracking-tight px-6 focus:bg-white focus:border-teal-300 transition-all outline-none">
                                            <option value="low">Low Signal</option>
                                            <option value="medium">Medium Signal</option>
                                            <option value="high">Critical Only</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex gap-4 pt-8 border-t border-slate-50">
                                    <Button type="submit" className="flex-1 bg-slate-900 text-white font-black h-14 rounded-2xl shadow-xl shadow-slate-900/10 text-[11px] tracking-[0.2em] uppercase active:scale-[0.98] transition-all">Submit Node</Button>
                                    <Button variant="ghost" onClick={() => setShowAddTask(false)} className="px-8 h-14 text-slate-400 font-bold uppercase text-[10px] tracking-widest rounded-2xl">Cancel</Button>
                                </div>
                            </form>
                        </Card>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {(['pending', 'in_progress', 'completed'] as const).map(status => (
                            <div key={status} className="space-y-6">
                                <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] pl-2 flex items-center gap-3">
                                    <span className={cn("w-1.5 h-1.5 rounded-full", status === 'completed' ? 'bg-teal-500' : 'bg-slate-200')} />
                                    {status}
                                </h4>
                                <div className="grid gap-6">
                                    {tasks.filter(t => t.type === 'directive' && t.status === status).map(t => (
                                        <TaskCard key={t.id} task={t} onStatusChange={handleStatusChange} onDelete={handleDeleteTask} isAdmin={isAdmin} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'activity' && (
                <div className="grid gap-3 max-w-4xl mx-auto animate-in fade-in duration-500">
                    {logs.map(log => (
                        <div key={log.id} className="bg-white border border-slate-50 p-6 rounded-[1.5rem] flex items-center justify-between group hover:border-teal-100 transition-all shadow-sm">
                            <div className="flex items-center gap-6">
                                <div className="w-12 h-12 rounded-[1.25rem] bg-teal-50 flex items-center justify-center text-teal-600 text-[11px] font-black uppercase group-hover:bg-teal-600 group-hover:text-white transition-all shadow-sm">{log.userName[0]}</div>
                                <div className="space-y-1">
                                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight leading-none">{log.userName}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none opacity-60">{log.action}</p>
                                </div>
                            </div>
                            <span className="text-[9px] font-black text-slate-200 uppercase tracking-[0.1em]">{log.timestamp && format(log.timestamp.toDate(), 'MMM d, h:mma')}</span>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'users' && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-in slide-in-from-bottom-4 duration-500">
                    {users.map(u => (
                        <Card key={u.uid} className="bg-white border border-slate-50 rounded-[2.5rem] p-8 flex flex-col items-center gap-4 hover:border-teal-300 transition-all shadow-sm hover:shadow-xl hover:shadow-teal-500/5 group">
                            <div className="w-16 h-16 rounded-[2rem] bg-slate-50 flex items-center justify-center text-slate-400 text-xl font-black uppercase group-hover:bg-teal-600 group-hover:text-white transition-all shadow-inner">{(u.displayName?.[0] ?? 'U').toUpperCase()}</div>
                            <div className="text-center space-y-1">
                                <p className="text-xs font-black text-slate-900 uppercase truncate tracking-tight">{u.displayName}</p>
                                <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest leading-none mt-2 opacity-60 group-hover:text-teal-600/80 transition-colors">{u.email}</p>
                            </div>
                            <select
                                value={u.role ?? 'staff'}
                                onChange={(e) => handleUpdateUserRole(u.uid, e.target.value as 'admin' | 'staff')}
                                className="w-full h-10 border border-slate-100 bg-slate-50/50 rounded-xl text-[10px] font-black uppercase tracking-widest px-3 outline-none focus:bg-white focus:border-teal-300"
                            >
                                <option value="staff">Staff</option>
                                <option value="admin">Admin</option>
                            </select>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminPortalPage;
