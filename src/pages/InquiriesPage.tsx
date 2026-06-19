import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { Loader2, MessageSquare, Search, Trash2 } from 'lucide-react';
import { db } from '../lib/firebase';
import type { WixInquiry } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import { logAudit } from '../lib/auditTrail';
import { PageHeaderSkeleton } from '../components/ui/skeleton';
import { cn } from '../lib/utils';
import { phoneMatchKey, normalizePhoneDigits } from '../lib/phoneNormalize';
import { Textarea } from '../components/ui/textarea';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import { INQUIRY_NOT_BOOKED_REASONS, inquiryNotBookedReasonLabel } from '../lib/wixInquiryReasons';

function mapInquiryDoc(id: string, raw: Record<string, unknown>): WixInquiry {
  const statusRaw = String(raw.status ?? 'new').toLowerCase();
  const status: WixInquiry['status'] =
    statusRaw === 'in_progress' ||
    statusRaw === 'responded' ||
    statusRaw === 'converted' ||
    statusRaw === 'closed' ||
    statusRaw === 'new'
      ? (statusRaw as WixInquiry['status'])
      : 'new';

  return {
    id,
    name: String(raw.name ?? 'Unknown'),
    email: String(raw.email ?? ''),
    phone: String(raw.phone ?? ''),
    message: String(raw.message ?? ''),
    service: String(raw.service ?? ''),
    submittedAt: String(raw.submittedAt ?? raw.lastChanged ?? new Date().toISOString()),
    status,
    assignedTo: raw.assignedTo ? String(raw.assignedTo) : undefined,
    phoneMatchExcluded: raw.phoneMatchExcluded === true,
    wixContactId: raw.wixContactId ? String(raw.wixContactId) : undefined,
    wixSubmissionId: raw.wixSubmissionId ? String(raw.wixSubmissionId) : undefined,
    wixFormId: raw.wixFormId ? String(raw.wixFormId) : undefined,
    lastWixSyncAt: raw.lastWixSyncAt ? String(raw.lastWixSyncAt) : undefined,
    wixSourceType: raw.wixSourceType ? String(raw.wixSourceType) : undefined,
    staffNotes: raw.staffNotes ? String(raw.staffNotes) : undefined,
    staffNotesUpdatedAt: raw.staffNotesUpdatedAt ? String(raw.staffNotesUpdatedAt) : undefined,
    staffNotesBy: raw.staffNotesBy ? String(raw.staffNotesBy) : undefined,
    duplicateOf: raw.duplicateOf ? String(raw.duplicateOf) : undefined,
    notBookedReason: raw.notBookedReason ? String(raw.notBookedReason) : undefined,
    closedAt: raw.closedAt ? String(raw.closedAt) : undefined,
    closedBy: raw.closedBy ? String(raw.closedBy) : undefined,
  };
}

type DisplayInquiry = WixInquiry & { duplicateCount?: number };

function dedupeInquiriesByPhone(items: WixInquiry[]): DisplayInquiry[] {
  const byPhone = new Map<string, WixInquiry[]>();
  const noPhone: WixInquiry[] = [];

  for (const item of items) {
    if (item.duplicateOf) continue;
    const key = phoneMatchKey(normalizePhoneDigits(item.phone));
    if (!key) {
      noPhone.push(item);
      continue;
    }
    const list = byPhone.get(key) ?? [];
    list.push(item);
    byPhone.set(key, list);
  }

  const rows: DisplayInquiry[] = [];
  for (const list of byPhone.values()) {
    const sorted = [...list].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const primary = sorted[0];
    rows.push({
      ...primary,
      duplicateCount: sorted.length > 1 ? sorted.length - 1 : undefined,
    });
  }
  for (const item of noPhone) rows.push(item);

  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

const STATUS_LABELS: Record<WixInquiry['status'], string> = {
  new: 'New',
  in_progress: 'Active',
  responded: 'Responded',
  converted: 'Converted',
  closed: 'Closed',
};

function inquiryIsOpen(inquiry: WixInquiry): boolean {
  return isOpenWixInquiryDoc(inquiry as unknown as Record<string, unknown>);
}

function inquiryMatchesSearch(row: DisplayInquiry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const submittedLabel = row.submittedAt
    ? format(new Date(row.submittedAt), 'MM/dd/yyyy').toLowerCase()
    : '';
  const haystack = [
    row.name,
    row.phone ?? '',
    row.email,
    row.service,
    row.message,
    row.staffNotes ?? '',
    STATUS_LABELS[row.status],
    inquiryNotBookedReasonLabel(row.notBookedReason) ?? '',
    submittedLabel,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

const InquiriesPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [inquiries, setInquiries] = useState<WixInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showExistingPatients, setShowExistingPatients] = useState(false);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const [closeReasonDraft, setCloseReasonDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'wixInquiries'),
      (snap) => {
        const data = snap.docs
          .map((d) => mapInquiryDoc(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
        setInquiries(data);
        setLoading(false);
      },
      (err) => {
        console.error('wixInquiries listener failed', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const newLeadInquiries = useMemo(() => inquiries.filter((i) => !i.phoneMatchExcluded), [inquiries]);
  const hiddenInquiries = useMemo(() => inquiries.filter((i) => i.phoneMatchExcluded), [inquiries]);
  const visibleInquiries = useMemo(
    () => (showExistingPatients ? inquiries : newLeadInquiries).filter(inquiryIsOpen),
    [inquiries, newLeadInquiries, showExistingPatients]
  );
  const displayRows = useMemo(() => dedupeInquiriesByPhone(visibleInquiries), [visibleInquiries]);
  const filteredRows = useMemo(
    () => displayRows.filter((row) => inquiryMatchesSearch(row, search)),
    [displayRows, search]
  );
  const searchTrimmed = search.trim();
  const activeLeadCount = useMemo(
    () => newLeadInquiries.filter(inquiryIsOpen).length,
    [newLeadInquiries]
  );

  const handleCloseInquiry = async (inquiry: WixInquiry) => {
    const reason = closeReasonDraft[inquiry.id] ?? inquiry.notBookedReason ?? '';
    if (!reason) return;

    const author = userProfile?.displayName ?? user?.email ?? 'User';
    setUpdatingId(inquiry.id);
    try {
      await updateDoc(doc(db, 'wixInquiries', inquiry.id), {
        status: 'closed',
        notBookedReason: reason,
        closedAt: new Date().toISOString(),
        closedBy: author,
        lastChanged: new Date().toISOString(),
      });
      await logActivity({
        userId: user!.uid,
        userEmail: user!.email!,
        userName: author,
        action: `Inquiry closed: ${INQUIRY_NOT_BOOKED_REASONS.find((r) => r.id === reason)?.label ?? reason}`,
        section: 'Inquiries',
      });
      await logAudit({
        entityType: 'inquiry',
        entityId: inquiry.id,
        action: 'close',
        field: 'status',
        previousValue: inquiry.status,
        newValue: 'closed',
        userId: user!.uid,
        userEmail: user!.email!,
        userName: author,
      });
      setCloseReasonDraft((prev) => {
        const next = { ...prev };
        delete next[inquiry.id];
        return next;
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const saveStaffNotes = async (inquiry: WixInquiry) => {
    const draft = notesDraft[inquiry.id] ?? inquiry.staffNotes ?? '';
    setSavingNotesId(inquiry.id);
    const author = userProfile?.displayName ?? user?.email ?? 'User';
    await updateDoc(doc(db, 'wixInquiries', inquiry.id), {
      staffNotes: draft.trim() || '',
      staffNotesUpdatedAt: new Date().toISOString(),
      staffNotesBy: author,
    });
    setNotesDraft((prev) => {
      const next = { ...prev };
      delete next[inquiry.id];
      return next;
    });
    setSavingNotesId(null);
  };

  return (
    <div className="p-4 space-y-4 max-w-full mx-auto bg-[#f1f5f9] min-h-screen font-sans">
      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-teal-600 flex items-center justify-center shadow-lg shadow-teal-600/10">
            <MessageSquare className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Patient Inquiries</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
              Website leads — duplicates collapsed by phone
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-teal-50 px-3 py-1.5 rounded border border-teal-100 text-[10px] font-bold text-teal-600 uppercase tracking-tight">
            {activeLeadCount} new lead{activeLeadCount === 1 ? '' : 's'}
          </div>
          {hiddenInquiries.length > 0 && (
            <div className="bg-slate-100 px-3 py-1.5 rounded border border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
              {hiddenInquiries.length} existing patient{hiddenInquiries.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

      {hiddenInquiries.length > 0 && (
        <label className="flex items-center gap-2 px-1 text-[11px] font-medium text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showExistingPatients}
            onChange={(e) => setShowExistingPatients(e.target.checked)}
            className="rounded border-slate-300"
          />
          Show inquiries from existing patients ({hiddenInquiries.length} hidden by phone match)
        </label>
      )}

      {loading ? (
        <div className="space-y-4">
          <PageHeaderSkeleton />
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          </div>
        </div>
      ) : displayRows.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-md border border-slate-200 text-sm text-slate-500">
          {inquiries.length > 0
            ? hiddenInquiries.length > 0 && !showExistingPatients
              ? `${hiddenInquiries.length} recent inquir${hiddenInquiries.length === 1 ? 'y is' : 'ies are'} from phones already on file — enable “existing patients” above to review.`
              : 'No open inquiries to show.'
            : 'No inquiries yet. New website submissions appear here automatically (synced every 5 minutes).'}
        </div>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search this section: name, phone, email, service, message, notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-9 text-xs font-bold border-slate-200"
                aria-label="Search inquiries"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {searchTrimmed ? (
                <>
                  <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                    {filteredRows.length} of {displayRows.length} in this section
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] font-black uppercase"
                    onClick={() => setSearch('')}
                  >
                    Clear
                  </Button>
                </>
              ) : (
                <span className="text-[10px] font-bold text-slate-400">
                  {displayRows.length} open inquir{displayRows.length === 1 ? 'y' : 'ies'}
                </span>
              )}
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-slate-200 rounded-md text-sm text-slate-500">
              No inquiries match your search.
            </div>
          ) : (
        <div className="overflow-hidden overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto border border-slate-200 rounded-md">
          <table className="w-full text-left text-sm min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <tr>
                <th className="p-3 pl-4">Name</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Email</th>
                <th className="p-3">Service</th>
                <th className="p-3 min-w-[180px]">Message</th>
                <th className="p-3 min-w-[200px]">Staff notes</th>
                <th className="p-3">Submitted</th>
                <th className="p-3">Status</th>
                <th className="p-3 pr-4 min-w-[220px]">Why not booked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((inquiry) => {
                const noteVal = notesDraft[inquiry.id] ?? inquiry.staffNotes ?? '';
                const closeReason = closeReasonDraft[inquiry.id] ?? inquiry.notBookedReason ?? '';
                const busy = updatingId === inquiry.id;
                return (
                  <tr
                    key={inquiry.id}
                    className="align-top hover:bg-slate-50/80"
                  >
                    <td className="p-3 pl-4 font-bold text-slate-900">
                      {inquiry.name}
                      {inquiry.duplicateCount ? (
                        <span className="ml-1 text-[9px] font-bold text-amber-600 uppercase">
                          +{inquiry.duplicateCount} dup
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 text-xs text-slate-700">{inquiry.phone || '—'}</td>
                    <td className="p-3 text-xs text-slate-600 truncate max-w-[160px]">{inquiry.email || '—'}</td>
                    <td className="p-3 text-[10px] font-bold text-slate-500 uppercase">{inquiry.service || '—'}</td>
                    <td className="p-3 text-[11px] text-slate-600 whitespace-pre-wrap max-w-[220px]">
                      {inquiry.message ? `"${inquiry.message}"` : '—'}
                    </td>
                    <td className="p-3">
                      <Textarea
                        rows={2}
                        className="text-[11px] min-h-[52px] resize-y"
                        value={noteVal}
                        disabled={savingNotesId === inquiry.id}
                        onChange={(e) => setNotesDraft((prev) => ({ ...prev, [inquiry.id]: e.target.value }))}
                        placeholder="Internal follow-up notes…"
                      />
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-[9px] font-black uppercase text-teal-700 hover:underline disabled:opacity-40"
                          disabled={savingNotesId === inquiry.id}
                          onClick={() => void saveStaffNotes(inquiry)}
                        >
                          Save notes
                        </button>
                        {inquiry.staffNotesUpdatedAt && (
                          <span className="text-[9px] text-slate-400">
                            {format(new Date(inquiry.staffNotesUpdatedAt), 'MMM d, h:mm a')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
                      {inquiry.submittedAt ? format(new Date(inquiry.submittedAt), 'MM/dd/yyyy') : '—'}
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          'text-[9px] font-bold px-2 py-1 rounded uppercase',
                          inquiry.status === 'in_progress' && 'bg-amber-50 text-amber-700',
                          inquiry.status === 'converted' && 'bg-teal-50 text-teal-700',
                          inquiry.status === 'new' && 'bg-slate-100 text-slate-600'
                        )}
                      >
                        {STATUS_LABELS[inquiry.status]}
                      </span>
                    </td>
                    <td className="p-3 pr-4">
                      <div className="flex flex-col gap-2 min-w-[200px]">
                        <Select
                          value={closeReason}
                          disabled={busy}
                          onChange={(e) =>
                            setCloseReasonDraft((prev) => ({
                              ...prev,
                              [inquiry.id]: e.target.value,
                            }))
                          }
                          className="h-8 text-[11px] font-semibold border-slate-200"
                          aria-label={`Why not booked for ${inquiry.name}`}
                        >
                          <option value="">Select reason…</option>
                          {INQUIRY_NOT_BOOKED_REASONS.map((reason) => (
                            <option key={reason.id} value={reason.id}>
                              {reason.label}
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || !closeReason}
                          onClick={() => void handleCloseInquiry(inquiry)}
                          className="h-8 text-[9px] font-black uppercase border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              Delete
                            </>
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InquiriesPage;
