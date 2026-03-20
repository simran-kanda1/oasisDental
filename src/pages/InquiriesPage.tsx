import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WixInquiry } from '../types';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import { cn } from '../lib/utils';
import { MessageSquare, Phone, Mail, User, Clock } from 'lucide-react';

const InquiriesPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [inquiries, setInquiries] = useState<WixInquiry[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    // Mock data seeding for testing phase
    const seedMockInquiries = async () => {
        const mockData = [
            { name: 'Sarah Johnson', email: 'sarah.j@example.com', phone: '(416) 555-0123', message: 'I need to book a cleaning for next Wednesday.', status: 'pending', submittedAt: new Date().toISOString() },
            { name: 'Michael Chen', email: 'mchen@example.com', phone: '(905) 555-0987', message: 'Emergency: cracked tooth, can I come in today?', status: 'in_progress', submittedAt: new Date().toISOString() },
            { name: 'Emma Davis', email: 'emma.d@example.com', phone: '(289) 555-4567', message: 'Looking for teeth whitening options.', status: 'pending', submittedAt: new Date().toISOString() },
            { name: 'Robert Wilson', email: 'rwilson@example.com', phone: '(416) 555-7890', message: 'Follow up on my quote for the implant procedure.', status: 'pending', submittedAt: new Date().toISOString() },
        ];

        for (const lead of mockData) {
            await addDoc(collection(db, 'wixInquiries'), {
                ...lead,
                createdAt: serverTimestamp()
            });
        }
    };

    useEffect(() => {
        const q = query(collection(db, 'wixInquiries'), orderBy('submittedAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WixInquiry));
            setInquiries(data);
            setLoading(false);

            // Auto-seed if empty for testing
            if (data.length === 0 && !loading) {
                seedMockInquiries();
            }
        });
        return unsub;
    }, [loading]);

    const handleStatusUpdate = async (id: string, newStatus: WixInquiry['status']) => {
        setUpdatingId(id);
        const ref = doc(db, 'wixInquiries', id);
        await updateDoc(ref, {
            status: newStatus,
            lastChanged: new Date().toISOString()
        });
        await logActivity({
            userId: user!.uid,
            userEmail: user!.email!,
            userName: userProfile?.displayName ?? user!.email!,
            action: `Lead Status: ${newStatus}`,
            section: 'Inquiries'
        });
        setUpdatingId(null);
    };

    return (
        <div className="p-4 space-y-4 max-w-full mx-auto bg-[#f1f5f9] min-h-screen font-sans">
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-teal-600 flex items-center justify-center shadow-lg shadow-teal-600/10">
                        <MessageSquare className="text-white" size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Patient Inquiries</h1>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Wix Website Leads Signal</p>
                    </div>
                </div>

                <div className="bg-teal-50 px-3 py-1.5 rounded border border-teal-100 text-[10px] font-bold text-teal-600 uppercase tracking-tight">
                    {inquiries.filter(i => i.status !== 'converted').length} Active Leads
                </div>
            </div>

            {loading ? (
                <div className="p-20 text-center uppercase text-[10px] font-bold opacity-30 tracking-[0.3em] bg-white rounded-md border border-slate-200">Syncing Registry...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {inquiries.map(inquiry => (
                        <div
                            key={inquiry.id}
                            className={cn(
                                "bg-white border transition-all p-4 rounded-md flex flex-col justify-between group",
                                inquiry.status === 'converted' ? "opacity-60 grayscale border-slate-200" : "border-slate-200 hover:border-teal-400 shadow-sm"
                            )}
                        >
                            <div className="space-y-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-sm bg-slate-100 flex items-center justify-center text-slate-400">
                                            <User size={14} />
                                        </div>
                                        <h3 className="text-sm font-bold text-slate-900 tracking-tight">{inquiry.name}</h3>
                                    </div>
                                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-slate-100 text-slate-400 uppercase tracking-widest border border-slate-200 group-hover:bg-teal-50 group-hover:text-teal-600 group-hover:border-teal-100">Wix</span>
                                </div>

                                <div className="space-y-1.5 pt-2">
                                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                                        <Phone size={12} className="text-slate-300" />
                                        <span className="text-slate-700 font-bold">{inquiry.phone}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                                        <Mail size={12} className="text-slate-300" />
                                        <span className="text-slate-700 truncate">{inquiry.email}</span>
                                    </div>
                                </div>

                                {inquiry.message && (
                                    <div className="mt-3 p-3 bg-slate-50/50 border border-slate-100 rounded text-[11px] text-slate-600 leading-snug italic font-medium">
                                        "{inquiry.message}"
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 mt-4 border-t border-slate-50 flex items-center justify-between">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleStatusUpdate(inquiry.id, 'in_progress')}
                                        disabled={!!updatingId || inquiry.status === 'in_progress'}
                                        className={cn(
                                            "h-7 px-3 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1.5 border",
                                            inquiry.status === 'in_progress'
                                                ? "bg-amber-50 text-amber-600 border-amber-100"
                                                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-900 hover:text-white"
                                        )}
                                    >
                                        {inquiry.status === 'in_progress' ? <Clock size={10} /> : null}
                                        {inquiry.status === 'in_progress' ? 'Active' : 'Process'}
                                    </button>
                                    <button
                                        onClick={() => handleStatusUpdate(inquiry.id, 'converted')}
                                        disabled={!!updatingId || inquiry.status === 'converted'}
                                        className={cn(
                                            "h-7 px-3 rounded text-[9px] font-bold uppercase tracking-tight transition-all border",
                                            inquiry.status === 'converted'
                                                ? "bg-teal-50 text-teal-600 border-teal-100"
                                                : "bg-white text-slate-500 border-slate-200 hover:bg-teal-600 hover:text-white"
                                        )}
                                    >
                                        Convert
                                    </button>
                                </div>
                                <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-300 uppercase tracking-tight leading-none">
                                    {inquiry.submittedAt ? format(new Date(inquiry.submittedAt), 'MM/dd') : 'Signal'}
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
