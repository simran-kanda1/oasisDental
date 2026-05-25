import React from 'react';
import { format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { TASK_GROUP_LABELS, type TaskGroupId } from '../../lib/taskGroups';
import { RECEPTION_COLUMN_LABELS } from '../../lib/staffChecklist';
import type { TaskLinkTarget } from '../../lib/taskLinks';

export interface ChecklistTaskRow {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  taskGroup?: TaskGroupId;
  notes?: string;
  completedAt?: { toDate: () => Date };
  completedByName?: string;
  section: 'assigned' | 'reception' | 'dentist';
  columnLabel?: string;
  dentistLabel?: string;
  assigneeLabel?: string;
  linkTargets?: TaskLinkTarget[];
}

interface ChecklistBoardProps {
  rows: ChecklistTaskRow[];
  onToggle: (id: string) => void;
  onOpenNote: (id: string, notes: string) => void;
  emptyMessage?: string;
}

const statusStyles: Record<ChecklistTaskRow['status'], string> = {
  pending: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const priorityStyles: Record<ChecklistTaskRow['priority'], string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-sky-50 text-sky-700 border-sky-200',
  low: 'bg-slate-50 text-slate-500 border-slate-200',
};

export const ChecklistBoard: React.FC<ChecklistBoardProps> = ({
  rows,
  onToggle,
  onOpenNote,
  emptyMessage = 'No tasks for this view.',
}) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-[11px] text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="w-10 px-3 py-2.5" />
              <th className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest">Task</th>
              <th className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest w-28">Category</th>
              <th className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest w-32">Desk</th>
              <th className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest w-24">Priority</th>
              <th className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest w-28">Status</th>
              <th className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest w-20">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task, index) => {
              const done = task.status === 'completed';
              const completedAt =
                task.completedAt && typeof task.completedAt.toDate === 'function'
                  ? format(task.completedAt.toDate(), 'h:mm a')
                  : null;
              const groupLabel = task.taskGroup ? TASK_GROUP_LABELS[task.taskGroup] : '—';
              const desk =
                task.section === 'dentist'
                  ? task.dentistLabel ?? 'Dentist'
                  : task.section === 'reception'
                    ? task.columnLabel ?? 'Reception'
                    : 'Assigned';

              return (
                <tr
                  key={task.id}
                  className={cn(
                    'border-b border-slate-100 transition-colors hover:bg-slate-50/80',
                    index % 2 === 1 && 'bg-slate-50/30',
                    done && 'opacity-75'
                  )}
                >
                  <td className="px-3 py-2.5 align-top">
                    <button
                      type="button"
                      onClick={() => onToggle(task.id)}
                      className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5',
                        done ? 'bg-teal-600 border-teal-600' : 'border-slate-300 hover:border-teal-500 bg-white'
                      )}
                    >
                      {done && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <p className={cn('text-[12px] font-semibold text-slate-800 leading-snug', done && 'line-through text-slate-500')}>
                      {task.title}
                    </p>
                    {done && (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {completedAt ?? 'Done'}
                        {task.completedByName ? ` · ${task.completedByName}` : ''}
                      </p>
                    )}
                    {task.notes && !done && (
                      <p className="text-[10px] text-slate-500 mt-1 line-clamp-1 italic">{task.notes}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-tight border-slate-200">
                      {groupLabel}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">{desk}</span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span
                      className={cn(
                        'inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border',
                        priorityStyles[task.priority]
                      )}
                    >
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span
                      className={cn(
                        'inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border',
                        statusStyles[task.status]
                      )}
                    >
                      {task.status === 'completed' ? 'Done' : task.status === 'in_progress' ? 'Active' : 'Open'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <button
                      type="button"
                      onClick={() => onOpenNote(task.id, task.notes || '')}
                      className="p-1.5 rounded hover:bg-teal-50 text-slate-400 hover:text-teal-600"
                      aria-label="Add note"
                    >
                      <MessageSquare size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Compact week strip — unchanged UX, cleaner container */
export const ChecklistWeekStrip: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3 overflow-x-auto shadow-sm">
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">This week — tap a day</p>
    <div className="flex gap-2 min-w-[720px]">{children}</div>
  </div>
);

export { RECEPTION_COLUMN_LABELS };
