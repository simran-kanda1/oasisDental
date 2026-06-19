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
    getDaysInMonth,
} from 'date-fns';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { ChevronLeft, ChevronRight, ListChecks } from 'lucide-react';
import { navigateToSection } from '../lib/navigation';
import { logAudit } from '../lib/auditTrail';
import { ChecklistWeekStrip, type ChecklistTaskRow } from '../components/checklist/ChecklistBoard';
import { NO_APPT_BOOKED_QUEUE_ID } from '../data/queueRules';
import { useNavBadges } from '../contexts/NavBadgeContext';
import { deriveTaskGroupFromTitle, TASK_GROUP_ORDER, type TaskGroupId } from '../lib/taskGroups';
import type { RecurringTask } from '../data/tasksSchedule';
import {
    DENTIST_CHECKLIST_LABELS,
    DENTIST_TASK_TYPE,
    RECEPTION_COLUMN_LABELS,
    DENTIST_ASSIGNMENT_GENERAL,
    receptionColumnIndex,
    type DentistChecklistId,
} from '../lib/staffChecklist';
import { ChecklistColumn } from '../components/checklist/ChecklistColumn';
import { TaskLinkPicker } from '../components/checklist/TaskLinkPicker';
import {
    applyTaskLinkTarget,
    inferTaskLinkPresetId,
    linkTargetsForFirestore,
    resolveTaskLinkConfig,
    type TaskLinkTarget,
} from '../lib/taskLinks';

interface Task {
    id: string;
    type: 'protocol' | 'directive' | 'dentist_checklist';
    dentist?: DentistChecklistId;
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    date?: string;
    assignedTo?: string;
    assignmentScope?: 'general' | 'user';
    taskId?: string;
    taskGroup?: TaskGroupId;
    linkPresetId?: string;
    linkTargets?: TaskLinkTarget[];
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

/** Keep the same calendar day when changing month (e.g. May 21 → Apr 21). */
function alignDateToMonth(month: Date, date: Date): Date {
    const monthStart = startOfMonth(month);
    const day = Math.min(date.getDate(), getDaysInMonth(monthStart));
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
}

function templatesForDate(schedule: RecurringTask[], d: Date): RecurringTask[] {
    const w = dentrixWeekOfMonth(d);
    const day = dentrixDayOfWeek(d);
    return schedule.filter((t) => t.week === w && t.day === day).sort((a, b) => a.title.localeCompare(b.title));
}

const StaffTasksPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const badges = useNavBadges();
    const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [directives, setDirectives] = useState<Task[]>([]);
    const [protocols, setProtocols] = useState<Task[]>([]);
    const [dentistTasks, setDentistTasks] = useState<Task[]>([]);
    const [monthTasksByDate, setMonthTasksByDate] = useState<Map<string, Task[]>>(new Map());
    const [recurringSchedule, setRecurringSchedule] = useState<RecurringTask[]>([]);
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState('');
    const [linkPicker, setLinkPicker] = useState<{ title: string; targets: TaskLinkTarget[] } | null>(null);

    const scheduleByTemplateId = useMemo(() => {
        const map = new Map<string, RecurringTask>();
        recurringSchedule.forEach((t) => map.set(t.id, t));
        return map;
    }, [recurringSchedule]);

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

        const qDentist = query(
            collection(db, 'tasks'),
            where('type', '==', DENTIST_TASK_TYPE),
            where('date', '==', selectedDateStr)
        );
        const unsubDentist = onSnapshot(
            qDentist,
            (snap) => {
                setDentistTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Task)));
            },
            () => setDentistTasks([])
        );

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
                    const scheduleTpl = scheduleByTemplateId.get(d.id);
                    const linkFields = linkTargetsForFirestore(
                        scheduleTpl?.linkPresetId ?? inferTaskLinkPresetId(title)
                    );
                    await setDoc(taskRef, {
                        title,
                        type: 'protocol',
                        status: 'pending',
                        priority: 'medium',
                        date: selectedDateStr,
                        taskId: d.id,
                        taskGroup,
                        ...linkFields,
                        createdAt: serverTimestamp(),
                    });
                }
            }
        });

        return () => {
            unsubD();
            unsubP();
            unsubDentist();
            unsubSched();
        };
    }, [selectedDate, selectedDateStr, user?.email, scheduleByTemplateId]);

    const frontDeskCount = badges.frontDeskTotal;
    const estimateFollowUpCount = badges.estimatePredApproved + badges.estimatePredFollowUp;
    const inquiriesCount = badges.openInquiries;

    const handleToggleTask = async (task: Task) => {
        const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
        await updateDoc(doc(db, 'tasks', task.id), {
            status: nextStatus,
            completedAt: nextStatus === 'completed' ? serverTimestamp() : null,
            completedBy: nextStatus === 'completed' ? user?.email : null,
            completedByName: nextStatus === 'completed' ? userProfile?.displayName : null,
        });
        if (user?.uid && user.email) {
            await logAudit({
                entityType: 'task',
                entityId: task.id,
                action: 'status_change',
                field: 'status',
                previousValue: task.status,
                newValue: nextStatus,
                userId: user.uid,
                userEmail: user.email,
                userName: userProfile?.displayName ?? user.email,
                detail: task.title,
            });
        }
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
        const left: Task[] = [];
        const right: Task[] = [];
        for (const t of protocolsSorted) {
            const col = receptionColumnIndex(t.taskId ?? t.id);
            if (col === 0) left.push(t);
            else right.push(t);
        }
        return { left, right };
    }, [protocolsSorted]);

    const dentistTasksById = useMemo(() => {
        const map: Record<DentistChecklistId, Task[]> = { rick: [], vick: [] };
        for (const t of dentistTasks) {
            const key = t.dentist === 'vick' ? 'vick' : 'rick';
            map[key].push(t);
        }
        for (const key of Object.keys(map) as DentistChecklistId[]) {
            map[key].sort((a, b) => a.title.localeCompare(b.title));
        }
        return map;
    }, [dentistTasks]);

    const findTaskForTemplate = (dateStr: string, templateId: string): Task | undefined => {
        return monthTasksByDate.get(dateStr)?.find((t) => t.taskId === templateId);
    };

    const linkConfigForTask = (t: Task) =>
        resolveTaskLinkConfig({
            title: t.title,
            taskId: t.taskId,
            linkPresetId: t.linkPresetId ?? scheduleByTemplateId.get(t.taskId ?? '')?.linkPresetId,
            linkTargets: t.linkTargets,
        });

    const handleOpenTask = (row: ChecklistTaskRow) => {
        if (!row.linkTargets?.length) return;
        if (row.linkTargets.length === 1) {
            applyTaskLinkTarget(row.linkTargets[0]);
            return;
        }
        setLinkPicker({ title: row.title, targets: row.linkTargets });
    };

    const toRow = (t: Task, extra: Partial<ChecklistTaskRow>): ChecklistTaskRow => {
        const link = linkConfigForTask(t);
        return {
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            taskGroup: (t.taskGroup as TaskGroupId) || deriveTaskGroupFromTitle(t.title),
            notes: t.notes,
            completedAt: t.completedAt,
            completedByName: t.completedByName,
            section: 'assigned',
            linkTargets: link.targets.length ? link.targets : undefined,
            ...extra,
        };
    };

    const assignedRows = useMemo((): ChecklistTaskRow[] => {
        const rows: ChecklistTaskRow[] = directives.map((t) =>
            toRow(t, { section: 'assigned', columnLabel: 'Assigned to you' })
        );
        for (const t of dentistTasks) {
            const scope = t.assignmentScope ?? (t.assignedTo && t.assignedTo !== DENTIST_ASSIGNMENT_GENERAL ? 'user' : 'general');
            if (scope === 'user' && t.assignedTo === user?.email) {
                rows.push(
                    toRow(t, {
                        section: 'assigned',
                        assigneeLabel: DENTIST_CHECKLIST_LABELS[t.dentist === 'vick' ? 'vick' : 'rick'],
                    })
                );
            }
        }
        return rows;
    }, [directives, dentistTasks, user?.email]);

    const receptionRowsCol = (col: 0 | 1) =>
        protocolSplit[col === 0 ? 'left' : 'right'].map((t) =>
            toRow(t, { section: 'reception', columnLabel: RECEPTION_COLUMN_LABELS[col] })
        );

    const dentistRowsCol = (dentistId: DentistChecklistId) =>
        dentistTasksById[dentistId].map((t) =>
            toRow(t, {
                section: 'dentist',
                dentistLabel: DENTIST_CHECKLIST_LABELS[dentistId],
                assigneeLabel:
                    (t.assignmentScope ?? 'general') === 'general' || !t.assignedTo || t.assignedTo === DENTIST_ASSIGNMENT_GENERAL
                        ? 'General'
                        : t.assignedTo?.split('@')[0],
            })
        );

    const taskById = useMemo(() => {
        const map = new Map<string, Task>();
        [...directives, ...protocols, ...dentistTasks].forEach((t) => map.set(t.id, t));
        return map;
    }, [directives, protocols, dentistTasks]);

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
                            const tplLink = resolveTaskLinkConfig({
                                title: tpl.title,
                                taskId: tpl.id,
                                linkPresetId: tpl.linkPresetId,
                            });
                            const canOpen = tplLink.targets.length > 0;
                            return (
                                <div
                                    key={tpl.id}
                                    className={cn(
                                        'px-2 py-1.5 border-b border-slate-50 text-[10px] leading-tight',
                                        done && 'bg-slate-50 text-slate-500 line-through'
                                    )}
                                >
                                    {canOpen ? (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (tplLink.targets.length === 1) {
                                                    applyTaskLinkTarget(tplLink.targets[0]);
                                                } else {
                                                    setLinkPicker({ title: tpl.title, targets: tplLink.targets });
                                                }
                                            }}
                                            className={cn(
                                                'text-left w-full hover:text-teal-700',
                                                done && 'line-through'
                                            )}
                                        >
                                            {tpl.title}
                                        </button>
                                    ) : (
                                        tpl.title
                                    )}
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
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px] font-bold uppercase"
                        onClick={() => {
                            const nextMonth = startOfMonth(addMonths(viewMonth, -1));
                            setViewMonth(nextMonth);
                            setSelectedDate(alignDateToMonth(nextMonth, selectedDate));
                        }}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-black text-slate-800 min-w-[120px] text-center uppercase">{format(viewMonth, 'MMMM yyyy')}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px] font-bold uppercase"
                        onClick={() => {
                            const nextMonth = startOfMonth(addMonths(viewMonth, 1));
                            setViewMonth(nextMonth);
                            setSelectedDate(alignDateToMonth(nextMonth, selectedDate));
                        }}
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button size="sm" className="h-8 text-[10px] font-bold uppercase bg-teal-600" onClick={() => { const t = new Date(); setViewMonth(startOfMonth(t)); setSelectedDate(t); }}>
                        Jump to today
                    </Button>
                </div>
            </div>

            <div className="rounded-lg border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="flex items-start gap-3 shrink-0">
                    <div className="rounded-lg bg-teal-600 p-2 text-white shadow-sm">
                        <ListChecks className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-teal-900 uppercase tracking-tight">Daily rhythm</p>
                        <ol className="mt-2 space-y-1.5 text-[11px] text-slate-700 list-decimal list-inside leading-snug max-w-xl">
                            <li>Pick today on the week strip (amber outline = today).</li>
                            <li>Tap a task title (teal) to open the linked queue or page; check off when done.</li>
                            <li>Add a note on the speech icon if something is blocked.</li>
                            <li>Work assigned-to-you items at the top first.</li>
                            <li>Use the counters below to jump to no future appointments, estimates, or inquiries.</li>
                        </ol>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end sm:ml-auto">
                    <Button variant="outline" size="sm" className="h-8 text-[9px] font-bold uppercase" onClick={() => navigateToSection('frontDeskQueues')}>
                        No future appointments
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-[9px] font-bold uppercase" onClick={() => navigateToSection('followUpOutreach')}>
                        Estimates
                    </Button>
                </div>
            </div>

            <ChecklistWeekStrip>
                {weekDays.map((d) => (
                    <WeekDayColumn key={d.toISOString()} day={d} />
                ))}
            </ChecklistWeekStrip>

            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                        <p className="text-[9px] font-black text-teal-600 uppercase tracking-widest">Selected day</p>
                        <p className="text-lg font-black text-slate-900">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase" onClick={() => setSelectedDate((d) => addDays(d, -1))}>
                            Prev day
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 text-[10px] font-bold uppercase" onClick={() => setSelectedDate((d) => addDays(d, 1))}>
                            Next day
                        </Button>
                    </div>
                </div>

                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Assigned to you</p>
                <ChecklistColumn
                    title="Assigned to you"
                    rows={assignedRows}
                    onToggle={(id) => {
                        const task = taskById.get(id);
                        if (task) void handleToggleTask(task);
                    }}
                    onOpenNote={(id, notes) => {
                        setActiveCommentId(id);
                        setCommentDraft(notes);
                    }}
                    onOpenTask={handleOpenTask}
                    emptyMessage="Nothing assigned to you for this day."
                />

                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest pt-2">
                    Reception — two columns
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ChecklistColumn
                        title={RECEPTION_COLUMN_LABELS[0]}
                        rows={receptionRowsCol(0)}
                        onToggle={(id) => {
                            const task = taskById.get(id);
                            if (task) void handleToggleTask(task);
                        }}
                        onOpenNote={(id, notes) => {
                            setActiveCommentId(id);
                            setCommentDraft(notes);
                        }}
                        onOpenTask={handleOpenTask}
                        emptyMessage="No tasks in this column"
                    />
                    <ChecklistColumn
                        title={RECEPTION_COLUMN_LABELS[1]}
                        rows={receptionRowsCol(1)}
                        onToggle={(id) => {
                            const task = taskById.get(id);
                            if (task) void handleToggleTask(task);
                        }}
                        onOpenNote={(id, notes) => {
                            setActiveCommentId(id);
                            setCommentDraft(notes);
                        }}
                        onOpenTask={handleOpenTask}
                        emptyMessage="No tasks in this column"
                    />
                </div>

                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest pt-2">Dentist checklists</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(['rick', 'vick'] as const).map((dentistId) => (
                        <ChecklistColumn
                            key={dentistId}
                            title={DENTIST_CHECKLIST_LABELS[dentistId]}
                            rows={dentistRowsCol(dentistId)}
                            onToggle={(id) => {
                                const task = taskById.get(id);
                                if (task) void handleToggleTask(task);
                            }}
                            onOpenNote={(id, notes) => {
                                setActiveCommentId(id);
                                setCommentDraft(notes);
                            }}
                            onOpenTask={handleOpenTask}
                            emptyMessage="No tasks for this dentist today"
                        />
                    ))}
                </div>
            </div>

            <TaskLinkPicker
                open={!!linkPicker}
                taskTitle={linkPicker?.title ?? ''}
                targets={linkPicker?.targets ?? []}
                onClose={() => setLinkPicker(null)}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-amber-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-amber-700 uppercase">No future appointments</p>
                    {badges.badgesReady ? (
                        <p className="text-2xl font-black text-amber-900 mt-1">{frontDeskCount}</p>
                    ) : (
                        <div className="h-8 w-16 mt-1 rounded bg-amber-100 animate-pulse" />
                    )}
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">All visit queues and no appt booked patients</p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 h-8 text-[9px] font-bold uppercase w-full"
                        onClick={() => navigateToSection('frontDeskQueues', NO_APPT_BOOKED_QUEUE_ID)}
                    >
                        Open
                    </Button>
                </div>
                <div className="bg-white border border-orange-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-orange-700 uppercase">Estimate follow-up</p>
                    {badges.estimatesReady ? (
                        <p className="text-2xl font-black text-orange-900 mt-1">{estimateFollowUpCount}</p>
                    ) : (
                        <div className="h-8 w-16 mt-1 rounded bg-orange-100 animate-pulse" />
                    )}
                    <Button variant="outline" size="sm" className="mt-3 h-8 text-[9px] font-bold uppercase w-full" onClick={() => navigateToSection('followUpOutreach')}>
                        Open
                    </Button>
                </div>
                <div className="bg-white border border-indigo-200 rounded-lg p-4">
                    <p className="text-[9px] font-black text-indigo-700 uppercase">Inquiries</p>
                    <p className="text-2xl font-black text-indigo-900 mt-1">{inquiriesCount}</p>
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
