import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { applyTaskLinkTarget, type TaskLinkTarget } from '../../lib/taskLinks';

export interface TaskLinkPickerProps {
  open: boolean;
  taskTitle: string;
  targets: TaskLinkTarget[];
  onClose: () => void;
}

export const TaskLinkPicker: React.FC<TaskLinkPickerProps> = ({ open, taskTitle, targets, onClose }) => {
  if (!open || targets.length === 0) return null;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/20 z-[100]" onClick={onClose} aria-hidden />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-[101]">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Open workspace</h4>
        <p className="text-xs font-semibold text-slate-800 mb-4 leading-snug">{taskTitle}</p>
        <div className="space-y-2">
          {targets.map((target) => (
            <Button
              key={`${target.section}-${target.queueId ?? ''}`}
              type="button"
              variant="outline"
              className="w-full h-10 text-[10px] font-bold uppercase justify-between"
              onClick={() => {
                applyTaskLinkTarget(target);
                onClose();
              }}
            >
              {target.label}
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </Button>
          ))}
        </div>
        <Button type="button" variant="ghost" className="w-full mt-3 h-8 text-[10px] font-bold uppercase" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
};
