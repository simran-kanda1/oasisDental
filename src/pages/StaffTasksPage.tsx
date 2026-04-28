import React, { useState, useEffect, useMemo } from 'react';
import {
    collection,
    query,
    where,
    onSnapshot,
    doc,
    updateDoc,
    serverTimestamp,
    setDoc,
    getDoc,
    orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import {
    format,
    startOfMonth,
    endOfMonth,
    addDays,
    startOfWeek,
    addMonths,
    isSameDay,
    isSameMonth,
} from 'date-fns';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { MessageSquare, ChevronLeft, ChevronRight, ClipboardList, ListChecks } from 'lucide-react';
import { navigateToSection } from '../lib/navigation';
import { isRecallFollowUpDoc, isOpenOutreachItem } from '../lib/followUpQueues';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import { deriveTaskGroupFromTitle, TASK_GROUP_ORDER, type TaskGroupId } from '../lib/taskGroups';
import type { RecurringTask } from '../data/tasksSchedule';

interface Task {
    id: string;
    type: 'protocol' | 'directive';
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    date?: string;
    assignedTo?: string;
    taskId?: string;
    taskGroup?: TaskGroupId;
    notes?: string;
    lastCommentBy?: string;
    lastCommentAt?: unknown;
    completedAt?: { toDate: () => Date };
    completedByName?: string;
}

function dentrixWeekOfMonth(d: Date): number {
    return Math.min(4, Math.ceil(d.getDate() / 7));
}

function dentrixDayOfWeek(d: Date): number {
    const dow = d.getDay();
    if (dow === 0) return 1;
    return dow;
}

function templatesForDate(schedule: RecurringTask[], d: Date): RecurringTask[] {
    const w = dentrixWeekOfMonth(d);
    const day = dentrixDayOfWeek(d);
    return schedule.filter((t) => t.week === w && t.day === day).sort((a, b) => a.title.localeCompare(b.title));
}

const StaffTasksPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [directives, setDirectives] = useState<Task[]>([]);
    const [protocols, setProtocols] = useState<Task[]>([]);
    const [monthTasksByDate, setMonthTasksByDate] = useState<Map<string, Task[]>>(new Map());
    const [recurringSchedule, setRecurringSchedule] = useState<RecurringTask[]>([]);
    const [openRecallQueue, setOpenRecallQueue] = useState(0);
    const [openOutreachQueue, setOpenOutreachQueue] = useState(0);
    const [openInquiries, setOpenInquiries] = useState(0);
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState('');

    useEffect(() => {
        if (!activeCommentId) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setActiveCommentId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [activeCommentId]);

    const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
    const monthStartStr = format(startOfMonth(viewMonth), 'yyyy-MM-dd');
    const monthEndStr = format(endOfMonth(viewMonth), 'yyyy-MM-dd');

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'recurringTaskSchedule'), (snap) => {
            setRecurringSchedule(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecurringTask)));
        });
        return unsub;
    }, []);

    useEffect(() => {
        const q = query(
            collection(db, 'tasks'),
            where('type', '==', 'protocol'),
            where('date', '>=', monthStartStr),
            where('date', '<=', monthEndStr),
            orderBy('date', 'asc')
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                const map = new Map<string, Task[]>();
                snap.docs.forEach((d) => {
                    const t = { id: d.id, ...d.data() } as Task;
                    const date = t.date || '';
                    if (!map.has(date)) map.set(date, []);
                    map.get(date)!.push(t);
                });
                setMonthTasksByDate(map);
            },
            () => {
                setMonthTasksByDate(new Map());
            }
        );
        return unsub;
    }, [monthStartStr, monthEndStr]);

    useEffect(() => {
        const qD = query(collection(db, 'tasks'), where('type', '==', 'directive'), where('assignedTo', '==', user?.email));
        const unsubD = onSnapshot(qD, (snap) => {
            setDirectives(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Task)));
        });

        const qP = query(collection(db, 'tasks'), where('type', '==', 'protocol'), where('date', '==', selectedDateStr));
        const unsubP = onSnapshot(qP, (snap) => {
            setProtocols(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Task)));
        });

        const dayOfMonth = selectedDate.getDate();
        const activeWeek = Math.min(4, Math.ceil(dayOfMonth / 7));
        const activeDay = dentrixDayOfWeek(selectedDate);

        const qSched = query(collection(db, 'recurringTaskSchedule'), where('week', '==', activeWeek), where('day', '==', activeDay));
        const unsubSched = onSnapshot(qSched, async (snap) => {
            for (const d of snap.docs) {
                const data = d.data();
                const taskId = `${selectedDateStr}-${d.id}`;
                const taskRef = doc(db, 'tasks', taskId);
                const taskSnap = await getDoc(taskRef);
                if (!taskSnap.exists()) {
                    const title = String(data.title ?? '');
                    const rawGroup = String(data.taskGroup ?? '').trim();
                    const taskGroup = (TASK_GROUP_ORDER as readonly string[]).includes(rawGroup)
                        ? (rawGroup as TaskGroupId)
                        : deriveTaskGroupFromTitle(title);
                    await setDoc(taskRef, {
                        title,
                        type: 'protocol',
                        status: 'pending',
                        priority: 'medium',
                        date: selectedDateStr,
                        taskId: d.id,
                        taskGroup,
                        createdAt: serverTimestamp(),
                    });
                }
            }
        });

        return () => {
            unsubD();
            unsubP();
            unsubSched();
        };
    }, [selectedDate, selectedDateStr, user?.email]);

    useEffect(() => {
        const unsubFollowups = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', false)), (snap) => {
            let recall = 0;
            let outreach = 0;
            snap.docs.forEach((d) => {
                const data = d.data() as Record<string, unknown>;
                if (isRecallFollowUpDoc(data)) recall += 1;
                else if (isOpenOutreachItem(data)) outreach += 1;
            });
            setOpenRecallQueue(recall);
            setOpenOutreachQueue(outreach);
        });
        const unsubInquiries = onSnapshot(collection(db, 'wixInquiries'), (snap) => {
            const open = snap.docs.filter((d) => isOpenWixInquiryDoc(d.data() as Record<string, unknown>)).length;
            setOpenInquiries(open);
        });
        return () => {
            unsubFollowups();
            unsubInquiries();
        };
    }, []);

    const handleToggleTask = async (task: Task) => {
        const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
        await updateDoc(doc(db, 'tasks', task.id), {
            status: nextStatus,
            completedAt: nextStatus === 'completed' ? serverTimestamp() : null,
            completedBy: nextStatus === 'completed' ? user?.email : null,
            completedByName: nextStatus === 'completed' ? userProfile?.displayName : null,
        });
    };

    const handleSaveComment = async (id: string) => {
        if (!commentDraft.trim()) return;
        await updateDoc(doc(db, 'tasks', id), {
            notes: commentDraft,
            lastCommentBy: userProfile?.displayName || user?.email,
            lastCommentAt: serverTimestamp(),
        });
        setActiveCommentId(null);
        setCommentDraft('');
    };

    const weekMonday = startOfWeek(selectedDate, { weekStartsOn: 1 });
    const weekDays = [0, 1, 2, 3, 4, 5].map((i) => addDays(weekMonday, i));

    const protocolsSorted = useMemo(() => {
        const priorityRank: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };
        const groupIdx = (t: Task) => {
            const g = (t.taskGroup as TaskGroupId) || deriveTaskGroupFromTitle(t.title);
            const i = TASK_GROUP_ORDER.indexOf(g);
            return i === -1 ? 999 : i;
        };
        return [...protocols].sort((a, b) => {
            const g = groupIdx(a) - groupIdx(b);
            if (g !== 0) return g;
            const pr = priorityRank[a.priority] - priorityRank[b.priority];
            if (pr !== 0) return pr;
            return a.title.localeCompare(b.title);
        });
    }, [protocols]);

    const protocolSplit = useMemo(() => {
        const mid = Math.ceil(protocolsSorted.length / 2);
        return { left: protocolsSorted.slice(0, mid), right: protocolsSorted.slice(mid) };
    }, [protocolsSorted]);

    const findTaskForTemplate = (dateStr: string, templateId: string): Task | undefined => {
        return monthTasksByDate.get(dateStr)?.find((t) => t.taskId === templateId);
    };

    const TaskRow = ({ task }: { task: Task }) => {
        const done = task.status === 'completed';
        const completedAt =
            task.completedAt && typeof task.completedAt.toDate === 'function'
                ? format(task.completedAt.toDate(), 'h:mm a')
                : null;
        return (
            <div
                className={cn(
                    'group flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 transition-colors',
                    done && 'bg-slate-50 opacity-70'
                )}
            >
                <button
                    type="button"
                    onClick={() => handleToggleTask(task)}
                    className={cn(
                        'mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center',
                        done ? 'bg-teal-600 border-teal-600' : 'border-slate-300 hover:border-teal-500 bg-white'
                    )}
                >
                    {done && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                </button>
                <div className="flex-1 min-w-0">
                    <p className={cn('text-[12px] font-medium text-slate-800 leading-snug', done && 'line-through text-slate-500')}>
                        {task.title}
                    </p>
                    {done && (
                        <p className="text-[10px] text-slate-500 mt-1">
                            Done {completedAt ?? ''}
                            {task.completedByName ? ` · ${task.completedByName}` : ''}
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setActiveCommentId(task.id);
                        setCommentDraft(task.notes || '');
                    }}
                    className="p-1 text-slate-300 hover:text-teal-600"
                >
                    <MessageSquare size={14} />
                </button>
            </div>
        );
    };

    const WeekDayColumn = ({ day }: { day: Date }) => {
        const ds = format(day, 'yyyy-MM-dd');
        const isSel = isSameDay(day, selectedDate);
        const isToday = isSameDay(day, new Date());
        const tpls = templatesForDate(recurringSchedule, day);
        return (
            <div
                className={cn(
                    'min-w-[120px] flex-1 border rounded-lg overflow-hidden flex flex-col bg-white',
                    isSel ? 'border-teal-500 ring-1 ring-teal-500/30' : 'border-slate-200',
                    isToday && !isSel && 'border-amber-300'
                )}
            >
                <button
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    aria-pressed={isSel}
                    aria-label={`${format(day, 'EEEE, MMMM d')}${isToday ? ', today' : ''}`}
                    className={cn(
                        'px-2 py-2 text-center border-b w-full',
                        isSel ? 'bg-teal-600 text-white' : isToday ? 'bg-amber-50' : 'bg-slate-50'
                    )}
                >
                    <p className="text-[9px] font-black uppercase tracking-widest">{format(day, 'EEE')}</p>
                    <p className="text-xs font-bold">{format(day, 'MMM d')}</p>
                </button>
                <div className="flex-1 max-h-[280px] overflow-y-auto text-left">
                    {tpls.length === 0 ? (
                        <p className="p-2 text-[9px] text-slate-400 text-center">—</p>
                    ) : (
                        tpls.map((tpl) => {
                            const t = findTaskForTemplate(ds, tpl.id);
                            const done = t?.status === 'completed';
                            const completedAt =
                                t?.completedAt && typeof t.completedAt.toDate === 'function'
                                    ? format(t.completedAt.toDate(), 'h:mm a')
                                    : null;
                            return (
                                <div
                                    key={tpl.id}
                                    className={cn(
                                        'px-2 py-1.5 border-b border-slate-50 text-[10px] leading-tight',
                                        done && 'bg-slate-50 text-slate-500 line-through'
                                    )}
                                >
                                    {tpl.title}
                                    {done && (
                                        <span className="block text-[9px] text-slate-400 not-italic no-underline mt-0.5 normal-case">
                                            {completedAt}
                                            {t?.completedByName ? ` · ${t.completedByName.split(' ')[0]}` : ''}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 space-y-5 max-w-full mx-auto bg-slate-100 min-h-screen font-sans pb-16">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-slate-200 rounded-lg p-4">
                <div>
                    <h1 className="text-lg font-black text-slate-900 uppercase tracking-tight">Staff checklist</h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Week view · month navigation</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase" onClick={() => setViewMonth((m) => addMonths(m, -1))}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-black text-slate-800 min-w-[120px] text-center uppercase">{format(viewMonth, 'MMMM yyyy')}</span>
                    <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase" onClick={() => setViewMonth((m) => addMonths(m, 1))}>
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button size="sm" className="h-8 text-[10px] font-bold uppercase bg-teal-600" onClick={() => { const t = new Date(); setViewMonth(startOfMonth(t)); setSelectedDate(t); }}>
                        Jump to today
                    </Button>
                </div>
            </div>

            {!isSameMonth(selectedDate, viewMonth) && (
                <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Selected day is outside the visible month — use arrows to switch month or pick a day below.
                </p>
            )}

            <div className="rounded-lg border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="flex items-start gap-3 shrink-0">
                    <div className="rounded-lg bg-teal-600 p-2 text-white shadow-sm">
                        <ListChecks className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-teal-900 uppercase tracking-tight">Daily rhythm</p>
                        <ol className="mt-2 space-y-1.5 text-[11px] text-slate-700 list-decimal list-inside leading-snug max-w-xl">
                            <li>Pick today on the week strip (amber outline = today).</li>
                            <li>Check off every protocol for that day; add a note on the speech icon if something is blocked.</li>
                            <li>Work directives at the top first — they are assigned only to you.</li>
                            <li>Use the counters below to jump to recalls, follow-up outreach, or inquiries.</li>
                        </ol>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end sm:ml-auto">
                    <Button variant="outline" size="sm" className="h-8 text-[9px] font-bold uppercase" onClick={() => navigateToSection('frontDeskQueues')}>
                        Queues
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-[9px] font-bold uppercase" onClick={() => navigateToSection('followUpOutreach')}>
                        Follow up
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-[9px] font-bold uppercase" onClick={() => navigateToSection('estimates')}>
                        Estimates
                    </Button>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1 flex items-center gap-2">
                    <ClipboardList className="w-3.5 h-3.5" aria-hidden />
                    This week (Mon–Sat) — tap a day to load its protocols
                </p>
                <div className="flex gap-2 min-w-[720px]">{weekDays.map((d) => <WeekDayColumn key={d.toISOString()} day={d} />)}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4 border-b border-slate-100 pb-3">
                    <div>
                        <p className="text-[9px] font-black text-teal-600 uppercase tracking-widest">Selected day</p>
                        <p className="text-lg font-black text-slate-900">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase" onClick={() => setSelectedDate((d) => addDays(d, -1))}>
                            Prev day
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase" onClick={() => setSelectedDate((d) => addDays(d, 1))}>
                            Next day
                        </Button>
                    </div>
                </div>

                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Directives (assigned to you)</p>
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 mb-6">
                    {directives.length === 0 ? (
                        <div className="p-6 text-center space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">No directives right now</p>
                            <p className="text-[11px] text-slate-500 leading-snug max-w-md mx-auto">
                                One-off tasks from the team show here. If something urgent is missing, ask an admin to add a directive assigned to you.
                            </p>
                        </div>
                    ) : (
                        directives.map((t) => <TaskRow key={t.id} task={t} />)
                    )}
                </div>

                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Today&apos;s protocols — two columns</p>
                {protocolsSorted.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center space-y-2">
                        <p className="text-xs font-bold text-slate-600">No protocol checklist for this calendar day</p>
                        <p className="text-[11px] text-slate-500 max-w-lg mx-auto leading-relaxed">
                            The recurring schedule may not define tasks for {format(selectedDate, 'EEEE')}, or templates are still syncing. Use the week strip to confirm what should run; protocols appear once the schedule is loaded for that weekday.
                        </p>
                    </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-slate-200 overflow-hidden min-h-[120px]">
                        {protocolSplit.left.map((t) => <TaskRow key={t.id} task={t} />)}
                    </div>
                    <div className="rounded-lg border border-slate-200 overflow-hidden min-h-[120px]">
                        {protocolSplit.right.map((t) => <TaskRow key={t.id} task={t} />)}
                    </div>
                </div>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white border border-amber-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-amber-700 uppercase">No appt booked</p>
                    <p className="text-2xl font-black text-amber-900 mt-1">{openRecallQueue}</p>
                    <Button variant="outline" size="sm" className="mt-3 h-8 text-[9px] font-bold uppercase w-full" onClick={() => navigateToSection('followups')}>
                        Open
                    </Button>
                </div>
                <div className="bg-white border border-orange-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-orange-700 uppercase">Follow-up outreach</p>
                    <p className="text-2xl font-black text-orange-900 mt-1">{openOutreachQueue}</p>
                    <Button variant="outline" size="sm" className="mt-3 h-8 text-[9px] font-bold uppercase w-full" onClick={() => navigateToSection('followUpOutreach')}>
                        Open
                    </Button>
                </div>
                <div className="bg-white border border-indigo-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-indigo-700 uppercase">Inquiries</p>
                    <p className="text-2xl font-black text-indigo-900 mt-1">{openInquiries}</p>
                    <Button variant="outline" size="sm" className="mt-3 h-8 text-[9px] font-bold uppercase w-full" onClick={() => navigateToSection('inquiries')}>
                        Open
                    </Button>
                </div>
            </div>

            {activeCommentId && (
                <>
                    <div className="fixed inset-0 bg-slate-900/20 z-[100]" onClick={() => setActiveCommentId(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-[101]">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase mb-2">Note</h4>
                        <p className="text-[9px] text-slate-400 mb-2">Press Esc to cancel</p>
                        <Input
                            autoFocus
                            value={commentDraft}
                            onChange={(e) => setCommentDraft(e.target.value)}
                            className="mb-3 h-9 text-xs"
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveComment(activeCommentId)}
                        />
                        <div className="flex gap-2">
                            <Button size="sm" className="flex-1 h-8 text-[10px] font-bold uppercase" onClick={() => handleSaveComment(activeCommentId)}>
                                Save
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-[10px] font-bold uppercase" onClick={() => setActiveCommentId(null)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default StaffTasksPage;
