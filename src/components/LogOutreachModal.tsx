import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';

export type OutreachChannel = 'call' | 'text' | 'email';
export type OutreachReached = 'yes' | 'no' | 'voicemail';

export interface OutreachLogPayload {
  channel: OutreachChannel;
  reached: OutreachReached;
  outcome: string;
  notes: string;
  callbackDate: string;
}

const defaultPayload: OutreachLogPayload = {
  channel: 'call',
  reached: 'no',
  outcome: '',
  notes: '',
  callbackDate: '',
};

interface LogOutreachModalProps {
  open: boolean;
  title?: string;
  patientLabel: string;
  onClose: () => void;
  onSave: (payload: OutreachLogPayload) => Promise<void>;
  saving?: boolean;
}

export const LogOutreachModal: React.FC<LogOutreachModalProps> = ({
  open,
  title = 'Log follow-up',
  patientLabel,
  onClose,
  onSave,
  saving = false,
}) => {
  const [form, setForm] = useState<OutreachLogPayload>(defaultPayload);

  useEffect(() => {
    if (open) setForm(defaultPayload);
  }, [open, patientLabel]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[100]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-8 z-[101] max-h-[90vh] overflow-y-auto">
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">{title}</h4>
        <p className="text-sm font-bold text-slate-900 mb-6 truncate" title={patientLabel}>
          {patientLabel}
        </p>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase">Channel</label>
            <Select
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as OutreachChannel }))}
              className="h-10 text-xs font-bold"
            >
              <option value="call">Call</option>
              <option value="text">Text</option>
              <option value="email">Email</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase">Reached</label>
            <Select
              value={form.reached}
              onChange={(e) => setForm((f) => ({ ...f, reached: e.target.value as OutreachReached }))}
              className="h-10 text-xs font-bold"
            >
              <option value="yes">Yes — spoke with patient</option>
              <option value="voicemail">Voicemail</option>
              <option value="no">No answer</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase">Outcome (short)</label>
            <Input
              value={form.outcome}
              onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
              placeholder="e.g. Booked hygiene, declined, call back…"
              className="h-10 text-xs font-bold"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase">Callback date (optional)</label>
            <Input
              type="date"
              value={form.callbackDate}
              onChange={(e) => setForm((f) => ({ ...f, callbackDate: e.target.value }))}
              className="h-10 text-xs font-bold"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase">Notes</label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Internal documentation…"
              className="min-h-[88px] text-xs font-medium"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <Button
            onClick={() => onSave(form)}
            disabled={saving}
            className="flex-1 h-11 bg-teal-600 hover:bg-teal-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl"
          >
            {saving ? 'Saving…' : 'Save log'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={saving} className="flex-1 h-11 border border-slate-100 font-black text-[10px] uppercase rounded-xl">
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
};
