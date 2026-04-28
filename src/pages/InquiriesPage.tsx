import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { Clock, Mail, MessageSquare, Phone, RefreshCw, User } from 'lucide-react';
import { db } from '../lib/firebase';
import type { WixInquiry } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { syncWixInquiriesAndPhoneFlags } from '../lib/wixInquirySync';

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
    lastWixSyncAt: raw.lastWixSyncAt ? String(raw.lastWixSyncAt) : undefined,
    wixSourceType: raw.wixSourceType ? String(raw.wixSourceType) : undefined,
  };
}

const InquiriesPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [inquiries, setInquiries] = useState<WixInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'wixInquiries'), orderBy('submittedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => mapInquiryDoc(d.id, d.data() as Record<string, unknown>));
        setInquiries(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const visibleInquiries = useMemo(() => inquiries.filter((i) => !i.phoneMatchExcluded), [inquiries]);
  const activeLeadCount = useMemo(() => visibleInquiries.filter((i) => i.status !== 'converted').length, [visibleInquiries]);

  const handleStatusUpdate = async (id: string, newStatus: WixInquiry['status']) => {
    setUpdatingId(id);
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
    setUpdatingId(null);
  };

  const handlePullFromWix = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const r = await syncWixInquiriesAndPhoneFlags();
      if (r.error) setSyncMessage(r.error);
      else setSyncMessage(`Synced ${r.leads} lead(s) from Wix.`);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
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
              Wix CRM via Firebase Function - existing patient phone matches hidden
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-teal-50 px-3 py-1.5 rounded border border-teal-100 text-[10px] font-bold text-teal-600 uppercase tracking-tight">
            {activeLeadCount} Active Leads
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-[10px] font-bold uppercase gap-1.5"
            disabled={syncing}
            onClick={() => void handlePullFromWix()}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            Pull from Wix
          </Button>
        </div>
      </div>

      {syncMessage && <div className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700">{syncMessage}</div>}

      {loading ? (
        <div className="p-20 text-center uppercase text-[10px] font-bold opacity-30 tracking-[0.3em] bg-white rounded-md border border-slate-200">
          Syncing Registry...
        </div>
      ) : visibleInquiries.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-md border border-slate-200 text-sm text-slate-500">
          {inquiries.length > 0
            ? 'All current inquiries match existing patient phone numbers, or none are open.'
            : 'No inquiries yet. Click Pull from Wix to sync from production source.'}
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
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-slate-100 text-slate-400 uppercase tracking-widest border border-slate-200 group-hover:bg-teal-50 group-hover:text-teal-600 group-hover:border-teal-100 shrink-0">
                    Wix
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
