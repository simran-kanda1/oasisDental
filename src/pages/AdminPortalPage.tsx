import React, { useState, useEffect } from 'react';
import {
    collection, addDoc, getDocs, updateDoc, doc, deleteDoc, setDoc,
    serverTimestamp, query, orderBy, onSnapshot, where, limit
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { type RecurringTask } from '../data/tasksSchedule';
import { isActiveDentrixPatient } from '../lib/dentrix';
import { isRecallFollowUpDoc, isOpenOutreachItem } from '../lib/followUpQueues';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import { deriveTaskGroupFromTitle } from '../lib/taskGroups';
import { logAudit } from '../lib/auditTrail';
import { createStaffUser } from '../lib/createStaffUser';
import {
    DENTIST_ASSIGNMENT_GENERAL,
    DENTIST_CHECKLIST_LABELS,
    DENTIST_TASK_TYPE,
    type DentistChecklistId,
} from '../lib/staffChecklist';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { format } from 'date-fns';
import { cn } from '../lib/utils';

interface Task {
    id: string;
    type: 'protocol' | 'directive' | 'dentist_checklist';
    dentist?: DentistChecklistId;
    date?: string;
    title: string;
    description?: string;
    assignedTo?: string;
    assignedToName?: string;
    assignmentScope?: 'general' | 'user';
    assignedBy?: string;
    assignedByName?: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    dueDate?: string;
    completedAt?: any;
    completedBy?: string;
    completedByName?: string;
    createdAt?: any;
    taskId?: string;
    notes?: string;
}

const TaskCard: React.FC<{
    task: Task;
    onStatusChange: (id: string, status: Task['status']) => void;
    onDelete: (id: string) => void;
    isAdmin: boolean;
    meta?: string;
}> = ({ task, onStatusChange, onDelete, isAdmin, meta }) => {
    const nextStatus: Record<Task['status'], Task['status']> = {
        pending: 'in_progress',
        in_progress: 'completed',
        completed: 'pending',
    };

    const assignedAt = task.createdAt?.toDate ? format(task.createdAt.toDate(), 'MMM d, h:mm a') : 'Recently';

    return (
        <div
            className={cn(
                'bg-white border border-slate-200 rounded-md p-3 flex items-start gap-3 group hover:border-teal-300 transition-colors',
                task.status === 'completed' && 'opacity-60'
            )}
        >
            <button
                type="button"
                onClick={() => onStatusChange(task.id, nextStatus[task.status])}
                className={cn(
                    'mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center',
                    task.status === 'completed' ? 'bg-teal-600 border-teal-600' : 'border-slate-300 hover:border-teal-500'
                )}
            >
                {task.status === 'completed' && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
            </button>
            <div className="flex-1 min-w-0">
                <p className={cn('text-[12px] font-bold text-slate-900', task.status === 'completed' && 'line-through text-slate-500')}>
                    {task.title}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                    {meta ?? task.assignedToName ?? task.assignedTo?.split('@')[0] ?? '—'} · {assignedAt}
                </p>
                {task.notes && <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-2">{task.notes}</p>}
            </div>
            {isAdmin && (
                <button
                    type="button"
                    onClick={() => onDelete(task.id)}
                    className="text-[9px] font-bold text-slate-400 hover:text-rose-600 uppercase opacity-0 group-hover:opacity-100 shrink-0"
                >
                    Delete
                </button>
            )}
        </div>
    );
};

const AdminPortalPage: React.FC = () => {
    const { user, userProfile, isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState<'tasks' | 'checklist' | 'activity' | 'audit' | 'users' | 'operations'>('tasks');
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [recurringSchedule, setRecurringSchedule] = useState<RecurringTask[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [showAddUser, setShowAddUser] = useState(false);
    const [userFormError, setUserFormError] = useState<string | null>(null);
    const [userFormSuccess, setUserFormSuccess] = useState<string | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [showAddTask, setShowAddTask] = useState(false);
    const [showAddDentistTask, setShowAddDentistTask] = useState(false);
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

    useEffect(() => {
        const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(80));
        const unsub = onSnapshot(q, (snap) => setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
        return unsub;
    }, []);

    const handleAddTask = async (t: any) => {
        const assignee = users.find(u => u.email === t.assignedTo);
        const ref = await addDoc(collection(db, 'tasks'), {
            ...t,
            type: 'directive',
            status: 'pending',
            assignedToName: assignee?.displayName || t.assignedTo.split('@')[0],
            assignedBy: user?.email,
            assignedByName: userProfile?.displayName || user?.email,
            createdAt: serverTimestamp()
        });
        if (user?.uid && user.email) {
            await logAudit({
                entityType: 'task',
                entityId: ref.id,
                action: 'assigned',
                field: 'assignedTo',
                newValue: t.assignedTo,
                userId: user.uid,
                userEmail: user.email,
                userName: userProfile?.displayName ?? user.email,
                detail: t.title,
            });
        }
        setShowAddTask(false);
    };

    const handleAddDentistTask = async (t: {
        title: string;
        dentist: DentistChecklistId;
        date: string;
        assignmentScope: 'general' | 'user';
        assignedTo?: string;
    }) => {
        const assignee = t.assignmentScope === 'user' ? users.find((u) => u.email === t.assignedTo) : null;
        await addDoc(collection(db, 'tasks'), {
            title: t.title,
            type: DENTIST_TASK_TYPE,
            dentist: t.dentist,
            date: t.date,
            status: 'pending',
            priority: 'medium',
            assignmentScope: t.assignmentScope,
            assignedTo: t.assignmentScope === 'user' ? t.assignedTo : DENTIST_ASSIGNMENT_GENERAL,
            assignedToName:
                t.assignmentScope === 'user'
                    ? assignee?.displayName || t.assignedTo?.split('@')[0]
                    : 'General',
            assignedBy: user?.email,
            assignedByName: userProfile?.displayName || user?.email,
            createdAt: serverTimestamp(),
        });
        setShowAddDentistTask(false);
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

    const refreshUsers = async () => {
        const snap = await getDocs(collection(db, 'users'));
        setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
    };

    const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setUserFormError(null);
        setUserFormSuccess(null);
        const formData = new FormData(e.currentTarget);
        const email = String(formData.get('email') ?? '').trim();
        const password = String(formData.get('password') ?? '');
        const displayName = String(formData.get('displayName') ?? '').trim();
        const role = (formData.get('role') as 'admin' | 'staff') || 'staff';

        if (password.length < 6) {
            setUserFormError('Password must be at least 6 characters.');
            return;
        }

        setCreatingUser(true);
        try {
            const created = await createStaffUser({
                email,
                password,
                displayName: displayName || email.split('@')[0],
                role,
            });
            setUserFormSuccess(`Created ${created.displayName} (${created.email}). They can sign in with that password.`);
            setShowAddUser(false);
            e.currentTarget.reset();
            await refreshUsers();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('already-exists')) {
                setUserFormError('An account with this email already exists.');
            } else if (msg.includes('permission-denied')) {
                setUserFormError('Admin access required.');
            } else {
                setUserFormError(msg);
            }
        } finally {
            setCreatingUser(false);
        }
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

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const directiveTasks = tasks.filter((t) => t.type === 'directive');
    const dentistTasksToday = tasks.filter(
        (t) => t.type === DENTIST_TASK_TYPE && (t.date ?? '') === todayStr
    );

    return (
        <div className="p-4 space-y-4 max-w-6xl mx-auto bg-[#f1f5f9] min-h-screen font-sans pb-16">
            <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight">Admin portal</h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Tasks, checklist schedule, users</p>
                </div>
                <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-md border border-slate-200">
                    {(['tasks', 'checklist', 'activity', 'audit', 'users', 'operations'] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveTab(tab)}
                            className={cn(
                                'px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight rounded transition-all',
                                activeTab === tab
                                    ? 'bg-white text-teal-700 border border-slate-200 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            )}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {loading && activeTab === 'tasks' ? (
                <div className="bg-white border border-slate-200 rounded-md p-12 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Loading…
                </div>
            ) : null}

            {activeTab === 'operations' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                            { label: 'Active patients', value: opsStats.activePatients, sub: `Total ${opsStats.patients}` },
                            { label: 'Appointments', value: opsStats.appointments },
                            { label: 'No appt booked', value: opsStats.pendingRecallQueue },
                            { label: 'Estimate follow-up', value: opsStats.pendingOutreachQueue },
                            { label: 'Open inquiries', value: opsStats.openInquiries },
                        ].map((s) => (
                            <div key={s.label} className="bg-white border border-slate-200 rounded-md p-4">
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{s.label}</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">{s.value}</p>
                                {s.sub && <p className="text-[9px] text-slate-400 mt-1">{s.sub}</p>}
                            </div>
                        ))}
                    </div>
                    <div className="bg-white border border-slate-200 rounded-md p-4">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Last Dentrix sync</p>
                        <p className="text-sm font-medium text-slate-800 mt-1 break-all">{lastSyncedAt}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-md p-4">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-3">Data quality</p>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex justify-between border-b border-slate-100 pb-2">
                                <span className="text-slate-600">Missing phone</span>
                                <span className="font-bold">{qualityStats.patientsMissingPhone}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-100 pb-2">
                                <span className="text-slate-600">Missing email</span>
                                <span className="font-bold">{qualityStats.patientsMissingEmail}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-100 pb-2">
                                <span className="text-slate-600">Missing provider</span>
                                <span className="font-bold">{qualityStats.appointmentsMissingProvider}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-100 pb-2">
                                <span className="text-slate-600">Stale sync (&gt;7d)</span>
                                <span className="font-bold">{qualityStats.stalePatientSyncRecords}</span>
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
                        <Button onClick={() => setShowAddRecurring(true)} size="sm" className="h-8 text-[10px] font-bold uppercase bg-teal-600">Add protocol</Button>
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
                <div className="space-y-4">
                    <div className="bg-white border border-slate-200 rounded-md p-4 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Staff assignments</h3>
                            <Button type="button" size="sm" variant="outline" className="h-8 text-[10px] font-bold uppercase" onClick={() => setShowAddTask(true)}>
                                Add task
                            </Button>
                        </div>
                        {showAddTask && (
                            <Card className="border border-slate-200 rounded-md shadow-sm">
                                <CardContent className="p-4 space-y-3">
                                    <form
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            const formData = new FormData(e.currentTarget);
                                            handleAddTask({
                                                title: formData.get('title') as string,
                                                assignedTo: formData.get('assignedTo') as string,
                                                priority: formData.get('priority') as Task['priority'],
                                            });
                                        }}
                                        className="space-y-3"
                                    >
                                        <Input name="title" placeholder="Task title…" required className="h-9 text-sm" />
                                        <div className="grid grid-cols-2 gap-3">
                                            <select name="assignedTo" className="h-9 border border-slate-200 rounded-md text-xs px-2">
                                                {users.map((u) => (
                                                    <option key={u.email} value={u.email}>
                                                        {u.displayName}
                                                    </option>
                                                ))}
                                            </select>
                                            <select name="priority" className="h-9 border border-slate-200 rounded-md text-xs px-2">
                                                <option value="low">Low</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">High</option>
                                            </select>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button type="submit" size="sm" className="h-8 text-[10px] font-bold uppercase bg-teal-600">
                                                Save
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" className="h-8 text-[10px] font-bold uppercase" onClick={() => setShowAddTask(false)}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </form>
                                </CardContent>
                            </Card>
                        )}
                        <div className="space-y-2">
                            {directiveTasks.length === 0 ? (
                                <p className="text-[11px] text-slate-500 py-4 text-center">No staff tasks yet</p>
                            ) : (
                                directiveTasks.map((t) => (
                                    <TaskCard
                                        key={t.id}
                                        task={t}
                                        onStatusChange={handleStatusChange}
                                        onDelete={handleDeleteTask}
                                        isAdmin={isAdmin}
                                        meta={`Assigned · ${t.assignedToName ?? t.assignedTo}`}
                                    />
                                ))
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-md p-4 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Dentist tasks (today)</h3>
                                <p className="text-[10px] text-slate-400 mt-0.5">General = whole team · Or assign to one person</p>
                            </div>
                            <Button type="button" size="sm" className="h-8 text-[10px] font-bold uppercase bg-teal-600" onClick={() => setShowAddDentistTask(true)}>
                                Add dentist task
                            </Button>
                        </div>
                        {showAddDentistTask && (
                            <Card className="border border-slate-200 rounded-md">
                                <CardContent className="p-4">
                                    <form
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            const formData = new FormData(e.currentTarget);
                                            const scope = formData.get('assignmentScope') as 'general' | 'user';
                                            handleAddDentistTask({
                                                title: formData.get('title') as string,
                                                dentist: formData.get('dentist') as DentistChecklistId,
                                                date: formData.get('date') as string,
                                                assignmentScope: scope,
                                                assignedTo: scope === 'user' ? (formData.get('assignedTo') as string) : undefined,
                                            });
                                        }}
                                        className="space-y-3"
                                    >
                                        <Input name="title" placeholder="Task description…" required className="h-9" />
                                        <div className="grid grid-cols-2 gap-3">
                                            <select name="dentist" className="h-9 border border-slate-200 rounded-md text-xs px-2">
                                                <option value="rick">{DENTIST_CHECKLIST_LABELS.rick}</option>
                                                <option value="vick">{DENTIST_CHECKLIST_LABELS.vick}</option>
                                            </select>
                                            <Input name="date" type="date" required defaultValue={todayStr} className="h-9" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <select name="assignmentScope" className="h-9 border border-slate-200 rounded-md text-xs px-2" defaultValue="general">
                                                <option value="general">General (everyone)</option>
                                                <option value="user">Specific person</option>
                                            </select>
                                            <select name="assignedTo" className="h-9 border border-slate-200 rounded-md text-xs px-2">
                                                {users.map((u) => (
                                                    <option key={u.email} value={u.email}>
                                                        {u.displayName}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button type="submit" size="sm" className="h-8 text-[10px] font-bold uppercase bg-teal-600">
                                                Save
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" className="h-8 text-[10px] font-bold uppercase" onClick={() => setShowAddDentistTask(false)}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </form>
                                </CardContent>
                            </Card>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(['rick', 'vick'] as const).map((dentistId) => (
                                <div key={dentistId} className="rounded-md border border-slate-200 overflow-hidden">
                                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-3 py-2 bg-slate-50 border-b border-slate-200">
                                        {DENTIST_CHECKLIST_LABELS[dentistId]}
                                    </p>
                                    <div className="p-2 space-y-2">
                                        {dentistTasksToday
                                            .filter((t) => t.dentist === dentistId)
                                            .map((t) => (
                                                <TaskCard
                                                    key={t.id}
                                                    task={t}
                                                    onStatusChange={handleStatusChange}
                                                    onDelete={handleDeleteTask}
                                                    isAdmin={isAdmin}
                                                    meta={
                                                        (t.assignmentScope ?? 'general') === 'general' ||
                                                        t.assignedTo === DENTIST_ASSIGNMENT_GENERAL
                                                            ? 'General'
                                                            : `Assigned · ${t.assignedToName ?? t.assignedTo}`
                                                    }
                                                />
                                            ))}
                                        {dentistTasksToday.filter((t) => t.dentist === dentistId).length === 0 && (
                                            <p className="text-[10px] text-slate-400 text-center py-4">No tasks</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'activity' && (
                <div className="bg-white border border-slate-200 rounded-md divide-y divide-slate-100">
                    {logs.map((log) => (
                        <div key={log.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold text-slate-800">{log.userName}</p>
                                <p className="text-[10px] text-slate-500 truncate">{log.action}</p>
                            </div>
                            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">
                                {log.timestamp && format(log.timestamp.toDate(), 'MMM d, h:mm a')}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'audit' && (
                <div className="bg-white border border-slate-200 rounded-md divide-y divide-slate-100">
                    {auditLogs.length === 0 ? (
                        <div className="p-12 text-center text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                            No audit entries yet
                        </div>
                    ) : (
                        auditLogs.map((entry) => (
                            <div
                                key={entry.id}
                                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-slate-50"
                            >
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">
                                        {entry.action} · {entry.entityType}
                                    </p>
                                    <p className="text-[10px] text-slate-500 mt-1 truncate">
                                        {entry.detail || entry.entityId}
                                        {entry.field && entry.newValue
                                            ? ` — ${entry.field}: ${entry.previousValue ?? '—'} → ${entry.newValue}`
                                            : ''}
                                    </p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{entry.userName || entry.userEmail}</p>
                                </div>
                                <span className="text-[9px] font-black text-slate-300 uppercase shrink-0">
                                    {entry.timestamp?.toDate ? format(entry.timestamp.toDate(), 'MMM d, h:mma') : '—'}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}

            {activeTab === 'users' && (
                <div className="space-y-4">
                    <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Team accounts</h3>
                                <p className="text-[10px] text-slate-400 mt-0.5">Create login for front desk or admin</p>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                className="h-8 text-[10px] font-bold uppercase bg-teal-600"
                                onClick={() => {
                                    setShowAddUser((v) => !v);
                                    setUserFormError(null);
                                    setUserFormSuccess(null);
                                }}
                            >
                                {showAddUser ? 'Cancel' : 'Add user'}
                            </Button>
                        </div>
                        {userFormSuccess && (
                            <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-md px-3 py-2">{userFormSuccess}</p>
                        )}
                        {userFormError && (
                            <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{userFormError}</p>
                        )}
                        {showAddUser && (
                            <form onSubmit={(e) => void handleCreateUser(e)} className="grid gap-3 border-t border-slate-100 pt-3">
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</label>
                                        <Input name="displayName" placeholder="Jane Smith" className="mt-1 h-9" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Email</label>
                                        <Input name="email" type="email" required placeholder="name@oasisdental.ca" className="mt-1 h-9" />
                                    </div>
                                </div>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Password</label>
                                        <Input name="password" type="password" required minLength={6} placeholder="Min 6 characters" className="mt-1 h-9" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Role</label>
                                        <select
                                            name="role"
                                            defaultValue="staff"
                                            className="mt-1 w-full h-9 border border-slate-200 rounded-md text-sm px-2"
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                </div>
                                <Button type="submit" disabled={creatingUser} className="h-9 text-[10px] font-bold uppercase bg-teal-600 w-full sm:w-auto">
                                    {creatingUser ? 'Creating…' : 'Create account'}
                                </Button>
                            </form>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {users.map((u) => (
                        <Card key={u.uid} className="border border-slate-200 rounded-md shadow-sm">
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                                        {(u.displayName?.[0] ?? 'U').toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-slate-900 truncate">{u.displayName}</p>
                                        <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
                                    </div>
                                </div>
                                <select
                                    value={u.role ?? 'staff'}
                                    onChange={(e) => handleUpdateUserRole(u.uid, e.target.value as 'admin' | 'staff')}
                                    className="w-full h-9 border border-slate-200 rounded-md text-xs font-bold uppercase px-2"
                                >
                                    <option value="staff">Staff</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </CardContent>
                        </Card>
                    ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPortalPage;
