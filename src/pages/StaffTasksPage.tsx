import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { format, startOfMonth, addDays, startOfWeek, addWeeks } from 'date-fns';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { ChevronLeft, ChevronRight, MessageSquare, CheckCircle2, Clock, ListTodo } from 'lucide-react';

interface Task {
    id: string;
    type: 'protocol' | 'directive';
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    date?: string;
    assignedTo?: string;
    notes?: string;
    lastCommentBy?: string;
    lastCommentAt?: any;
    completedAt?: any;
    completedByName?: string;
}

const StaffTasksPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [directives, setDirectives] = useState<Task[]>([]);
    const [protocols, setProtocols] = useState<Task[]>([]);
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState('');

    useEffect(() => {
        const todayStr = format(selectedDate, 'yyyy-MM-dd');

        const qD = query(collection(db, 'tasks'), where('type', '==', 'directive'), where('assignedTo', '==', user?.email));
        const unsubD = onSnapshot(qD, (snap) => {
            setDirectives(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
        });

        const qP = query(collection(db, 'tasks'), where('type', '==', 'protocol'), where('date', '==', todayStr));
        const unsubP = onSnapshot(qP, (snap) => {
            setProtocols(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
        });

        const dayOfMonth = selectedDate.getDate();
        const activeWeek = Math.min(4, Math.ceil(dayOfMonth / 7));
        const dayOfWeek = selectedDate.getDay();
        const activeDay = dayOfWeek === 0 ? 1 : (dayOfWeek > 5 ? 5 : dayOfWeek);

        const qSched = query(collection(db, 'recurringTaskSchedule'), where('week', '==', activeWeek), where('day', '==', activeDay));
        const unsubSched = onSnapshot(qSched, async (snap) => {
            for (const d of snap.docs) {
                const data = d.data();
                const taskId = `${todayStr}-${d.id}`;
                const taskRef = doc(db, 'tasks', taskId);
                const taskSnap = await getDoc(taskRef);
                if (!taskSnap.exists()) {
                    await setDoc(taskRef, {
                        title: data.title,
                        type: 'protocol',
                        status: 'pending',
                        priority: 'medium',
                        date: todayStr,
                        taskId: d.id,
                        createdAt: serverTimestamp()
                    });
                }
            }
        });

        return () => { unsubD(); unsubP(); unsubSched(); };
    }, [selectedDate, user?.email]);

    const handleToggleTask = async (task: Task) => {
        const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
        await updateDoc(doc(db, 'tasks', task.id), {
            status: nextStatus,
            completedAt: nextStatus === 'completed' ? serverTimestamp() : null,
            completedBy: nextStatus === 'completed' ? user?.email : null,
            completedByName: nextStatus === 'completed' ? userProfile?.displayName : null
        });
    };

    const handleSaveComment = async (id: string) => {
        if (!commentDraft.trim()) return;
        await updateDoc(doc(db, 'tasks', id), {
            notes: commentDraft,
            lastCommentBy: userProfile?.displayName || user?.email,
            lastCommentAt: serverTimestamp()
        });
        setActiveCommentId(null);
        setCommentDraft('');
    };

    const changeDate = (days: number) => {
        const newDate = addDays(selectedDate, days);
        if (newDate.getDay() === 0) setSelectedDate(addDays(newDate, 1));
        else if (newDate.getDay() === 6) setSelectedDate(addDays(newDate, 2));
        else setSelectedDate(newDate);
    };

    const setWeek = (weekNum: number) => {
        const monthStart = startOfMonth(new Date());
        const targetDate = addWeeks(monthStart, weekNum - 1);
        const monday = startOfWeek(targetDate, { weekStartsOn: 1 });
        setSelectedDate(monday);
    };

    const TaskRow = ({ task }: { task: Task }) => (
        <div className={cn(
            "group flex items-center gap-4 px-4 py-2 bg-white border-b border-slate-200 last:border-0 hover:bg-slate-50 transition-colors",
            task.status === 'completed' && "bg-slate-50/30"
        )}>
            <button
                onClick={() => handleToggleTask(task)}
                className={cn(
                    "w-4 h-4 rounded border border-slate-300 shrink-0 flex items-center justify-center transition-all",
                    task.status === 'completed' ? "bg-teal-600 border-teal-600" : "hover:border-teal-500 bg-white"
                )}
            >
                {task.status === 'completed' && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
            </button>

            <div className="flex-1 min-w-0 flex items-center gap-3">
                <p className={cn("text-[13px] font-medium text-slate-700 truncate", task.status === 'completed' && "line-through text-slate-400")}>
                    {task.title}
                </p>
                {task.priority === 'high' && (
                    <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm bg-rose-50 text-rose-600 uppercase tracking-tighter">High</span>
                )}
            </div>

            <div className="flex items-center gap-4 shrink-0">
                {task.notes && (
                    <div className="flex items-center gap-1 text-[10px] text-teal-600 font-bold max-w-[150px] truncate opacity-60">
                        <MessageSquare size={10} />
                        {task.notes}
                    </div>
                )}
                <button
                    onClick={() => { setActiveCommentId(task.id); setCommentDraft(task.notes || ''); }}
                    className="p-1 hover:bg-slate-100 rounded text-slate-300 hover:text-teal-600 transition-colors"
                >
                    <MessageSquare size={14} />
                </button>
                <div className="w-24 text-right">
                    {task.status === 'completed' ? (
                        <span className="text-[9px] font-bold text-teal-600 uppercase tracking-tight flex items-center justify-end gap-1">
                            <CheckCircle2 size={10} />
                            {task.completedByName?.split(' ')[0] || 'Done'}
                        </span>
                    ) : (
                        <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tight">Pending</span>
                    )}
                </div>
            </div>
        </div>
    );

    const currentWeek = Math.min(4, Math.ceil(selectedDate.getDate() / 7));

    return (
        <div className="p-4 space-y-4 max-w-full mx-auto bg-[#f1f5f9] min-h-screen font-sans">
            {/* Clinical Header */}
            <div className="bg-white border border-slate-200 rounded-sm p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-sm bg-teal-600 flex items-center justify-center">
                        <ListTodo className="text-white" size={16} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none uppercase">Staff Checklist</h1>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Oasis Dental Administration</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center bg-slate-50 p-1 rounded border border-slate-200">
                        {[1, 2, 3, 4].map(w => (
                            <button
                                key={w}
                                onClick={() => setWeek(w)}
                                className={cn(
                                    "px-4 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-tight transition-all",
                                    currentWeek === w ? "bg-white text-teal-600 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-800"
                                )}
                            >
                                Week {w}
                            </button>
                        ))}
                    </div>
                    <div className="bg-slate-900 px-3 py-1.5 rounded-sm text-[10px] font-bold text-white uppercase tracking-tight">
                        {directives.length + protocols.length} Active
                    </div>
                </div>
            </div>

            {/* Sub Nav */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-sm px-4 py-2">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => changeDate(-1)} className="h-7 px-3 text-[9px] font-bold uppercase rounded-sm border-slate-200">Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())} className="h-7 px-3 text-[9px] font-bold uppercase rounded-sm border-slate-200">Today</Button>
                    <Button variant="outline" size="sm" onClick={() => changeDate(1)} className="h-7 px-3 text-[9px] font-bold uppercase rounded-sm border-slate-200">Next Day</Button>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500 uppercase">
                    <div className="flex items-center gap-2">
                        <Clock size={12} className="text-teal-600" />
                        {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                    </div>
                    <span className="text-slate-300">|</span>
                    <span className="text-teal-600">Cycle Week {currentWeek}</span>
                </div>
            </div>

            {/* Protocol Table */}
            <div className="bg-white border border-slate-200 rounded-sm overflow-hidden shadow-sm">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                        Clinical Directives (Assigned to Me)
                    </h3>
                </div>
                <div className="min-h-[100px]">
                    {directives.length === 0 ? (
                        <div className="p-8 text-center text-[10px] font-bold uppercase text-slate-300">No personal directives for today</div>
                    ) : directives.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-sm overflow-hidden shadow-sm">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        Daily Operations Protocols
                    </h3>
                </div>
                <div className="min-h-[200px]">
                    {protocols.length === 0 ? (
                        <div className="p-12 text-center text-[10px] font-bold uppercase text-slate-300">No protocol items found for this registry date</div>
                    ) : protocols.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
            </div>

            {/* Note Modal */}
            {activeCommentId && (
                <>
                    <div className="fixed inset-0 bg-slate-900/10 z-[100]" onClick={() => setActiveCommentId(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xs bg-white rounded-sm shadow-2xl border border-slate-300 p-4 z-[101]">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 border-b pb-2">Entry Note</h4>
                        <Input
                            autoFocus
                            value={commentDraft}
                            onChange={(e) => setCommentDraft(e.target.value)}
                            placeholder="Clinical comments..."
                            className="h-9 text-xs font-medium border-slate-200 bg-slate-50 rounded-sm mb-4 focus:bg-white focus:ring-0"
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveComment(activeCommentId)}
                        />
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleSaveComment(activeCommentId)} className="flex-1 h-8 bg-slate-900 text-white font-bold text-[10px] uppercase rounded-sm">Save Entry</Button>
                            <Button size="sm" variant="outline" onClick={() => setActiveCommentId(null)} className="flex-1 h-8 border border-slate-200 text-[10px] font-bold uppercase rounded-sm">Exit</Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default StaffTasksPage;
