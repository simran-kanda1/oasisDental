import React from 'react';
import { format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChecklistTaskRow } from './ChecklistBoard';

interface ChecklistColumnProps {
  title: string;
  rows: ChecklistTaskRow[];
  onToggle: (id: string) => void;
  onOpenNote: (id: string, notes: string) => void;
  emptyMessage?: string;
}

export const ChecklistColumn: React.FC<ChecklistColumnProps> = ({
  title,
  rows,
  onToggle,
  onOpenNote,
  emptyMessage = 'No tasks',
}) => {
  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden min-h-[140px]">
      <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-3 py-2 bg-slate-50 border-b border-slate-200">
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-[10px] text-slate-400">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((task) => {
            const done = task.status === 'completed';
            const completedAt =
              task.completedAt && typeof task.completedAt.toDate === 'function'
                ? format(task.completedAt.toDate(), 'h:mm a')
                : null;
            return (
              <div
                key={task.id}
                className={cn('flex items-start gap-3 px-3 py-2.5', done && 'bg-slate-50/80 opacity-80')}
              >
                <button
                  type="button"
                  onClick={() => onToggle(task.id)}
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
                  {task.assigneeLabel && (
                    <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">{task.assigneeLabel}</p>
                  )}
                  {done && (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Done {completedAt ?? ''}
                      {task.completedByName ? ` · ${task.completedByName}` : ''}
                    </p>
                  )}
                  {task.notes && !done && (
                    <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 italic">{task.notes}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenNote(task.id, task.notes || '')}
                  className="p-1 text-slate-300 hover:text-teal-600 shrink-0"
                  aria-label="Note"
                >
                  <MessageSquare size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
