import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { Clock, Mail, MessageSquare, Phone, User } from 'lucide-react';
import { db } from '../lib/firebase';
import type { WixInquiry } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import { logAudit } from '../lib/auditTrail';
import { CardGridSkeleton, PageHeaderSkeleton } from '../components/ui/skeleton';
import { cn } from '../lib/utils';
function mapInquiryDoc(id: string, raw: Record<string, unknown>): WixInquiry {
  const statusRaw = String(raw.status ?? 'new').toLowerCase();
  const status: WixInquiry['status'] =
    statusRaw === 'in_progress' || statusRaw === 'responded' || statusRaw === 'converted' || statusRaw === 'new'
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
  };
}

const InquiriesPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [inquiries, setInquiries] = useState<WixInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showExistingPatients, setShowExistingPatients] = useState(false);

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
    () => (showExistingPatients ? inquiries : newLeadInquiries),
    [inquiries, newLeadInquiries, showExistingPatients]
  );
  const activeLeadCount = useMemo(
    () => newLeadInquiries.filter((i) => i.status !== 'converted').length,
    [newLeadInquiries]
  );

  const handleStatusUpdate = async (id: string, newStatus: WixInquiry['status']) => {
    setUpdatingId(id);
    const prev = inquiries.find((i) => i.id === id)?.status ?? 'new';
    const ref = doc(db, 'wixInquiries', id);
    await updateDoc(ref, {
      status: newStatus,
      lastChanged: new Date().toISOString(),
    });
    await logActivity({
      userId: user!.uid,
      userEmail: user!.email!,
      userName: userProfile?.displayName ?? user!.email!,
      action: `Lead Status: ${newStatus}`,
      section: 'Inquiries',
    });
    await logAudit({
      entityType: 'inquiry',
      entityId: id,
      action: 'status_change',
      field: 'status',
      previousValue: prev,
      newValue: newStatus,
      userId: user!.uid,
      userEmail: user!.email!,
      userName: userProfile?.displayName ?? user!.email!,
    });
    setUpdatingId(null);
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
              New website leads only — hidden if phone matches an existing patient file (not whether they booked)
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
          <CardGridSkeleton count={6} />
        </div>
      ) : visibleInquiries.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-md border border-slate-200 text-sm text-slate-500">
          {inquiries.length > 0
            ? hiddenInquiries.length > 0 && !showExistingPatients
              ? `${hiddenInquiries.length} recent inquir${hiddenInquiries.length === 1 ? 'y is' : 'ies are'} from phones already on file — enable “existing patients” above to review. This is not based on whether they already booked an appointment.`
              : 'No open inquiries to show.'
            : 'No inquiries yet. New website submissions appear here automatically (synced every 5 minutes).'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visibleInquiries.map((inquiry) => (
            <div
              key={inquiry.id}
              className={cn(
                'bg-white border transition-all p-4 rounded-md flex flex-col justify-between group',
                inquiry.status === 'converted' ? 'opacity-60 grayscale border-slate-200' : 'border-slate-200 hover:border-teal-400 shadow-sm'
              )}
            >
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-sm bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                      <User size={14} />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 tracking-tight truncate">{inquiry.name}</h3>
                  </div>
                  <span
                    className={cn(
                      'text-[8px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-widest border shrink-0',
                      inquiry.phoneMatchExcluded
                        ? 'bg-slate-200 text-slate-600 border-slate-300'
                        : 'bg-slate-100 text-slate-400 border-slate-200 group-hover:bg-teal-50 group-hover:text-teal-600 group-hover:border-teal-100'
                    )}
                  >
                    {inquiry.phoneMatchExcluded ? 'Existing patient' : 'Wix'}
                  </span>
                </div>

                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                    <Phone size={12} className="text-slate-300 shrink-0" />
                    <span className="text-slate-700 font-bold truncate">{inquiry.phone || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                    <Mail size={12} className="text-slate-300 shrink-0" />
                    <span className="text-slate-700 truncate">{inquiry.email || '-'}</span>
                  </div>
                </div>

                {inquiry.service && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate">{inquiry.service}</p>}

                {inquiry.message && (
                  <div className="mt-3 p-3 bg-slate-50/50 border border-slate-100 rounded text-[11px] text-slate-600 leading-snug italic font-medium whitespace-pre-wrap">
                    {`"${inquiry.message}"`}
                  </div>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-slate-50 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleStatusUpdate(inquiry.id, 'in_progress')}
                    disabled={!!updatingId || inquiry.status === 'in_progress'}
                    className={cn(
                      'h-7 px-3 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1.5 border',
                      inquiry.status === 'in_progress'
                        ? 'bg-amber-50 text-amber-600 border-amber-100'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-900 hover:text-white'
                    )}
                  >
                    {inquiry.status === 'in_progress' ? <Clock size={10} /> : null}
                    {inquiry.status === 'in_progress' ? 'Active' : 'Process'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatusUpdate(inquiry.id, 'converted')}
                    disabled={!!updatingId || inquiry.status === 'converted'}
                    className={cn(
                      'h-7 px-3 rounded text-[9px] font-bold uppercase tracking-tight transition-all border',
                      inquiry.status === 'converted'
                        ? 'bg-teal-50 text-teal-600 border-teal-100'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-teal-600 hover:text-white'
                    )}
                  >
                    Convert
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-300 uppercase tracking-tight leading-none shrink-0">
                  {inquiry.submittedAt ? format(new Date(inquiry.submittedAt), 'MM/dd') : '-'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default InquiriesPage;
