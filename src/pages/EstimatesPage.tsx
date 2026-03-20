import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FollowUp } from '../types';
import { Input } from '../components/ui/input';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';

const EstimatesPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [estimates, setEstimates] = useState<FollowUp[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        const q = query(collection(db, 'followUps'), orderBy('lastChanged', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            setEstimates(snap.docs.map(d => ({ id: d.id, ...d.data() } as FollowUp)));
            setLoading(false);
        });
        return unsub;
    }, []);

    const handleLogAction = async (e: FollowUp, type: string) => {
        setUpdatingId(e.id);
        const ref = doc(db, 'followUps', e.id);
        await updateDoc(ref, {
            lastChanged: new Date().toISOString(),
            contactedBy: userProfile?.displayName ?? user?.email ?? 'User',
            outcome: `${type}: Estimate Sent`
        });
        await logActivity({
            userId: user!.uid,
            userEmail: user!.email!,
            userName: userProfile?.displayName ?? user!.email!,
            action: `Sent Estimate: ${e.appointment.patient.name}`,
            section: 'Estimates'
        });
        setUpdatingId(null);
    };

    const filtered = estimates.filter(e => e.appointment.patient.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="p-8 space-y-12 max-w-full mx-auto bg-slate-50/50 font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Estimates</h1>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">Clinical Financial Node</p>
                </div>
                <div className="relative w-full md:max-w-xs transition-all">
                    <Input
                        placeholder="Search Registry..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-6 h-12 bg-white border-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-tight placeholder:text-slate-200 focus:ring-teal-500/10 focus:border-teal-500 transition-all shadow-sm"
                    />
                </div>
            </div>

            {loading ? (
                <div className="p-40 text-center uppercase text-[10px] font-black opacity-10 tracking-[0.3em]">Syncing...</div>
            ) : (
                <div className="bg-white border border-slate-100 rounded-[3rem] shadow-sm overflow-hidden shadow-teal-500/5">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100/50">
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] pl-12">Patient Name</th>
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Clinical Code</th>
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Registry Update</th>
                                <th className="p-8 text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] text-right pr-12">Portal Signal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filtered.map(e => (
                                <tr key={e.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-8 pl-12">
                                        <p className="text-xs font-black text-slate-900 uppercase tracking-tighter leading-none">{e.appointment.patient.name}</p>
                                        <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-2 opacity-60">ID: {e.appointment.patient.id}</p>
                                    </td>
                                    <td className="p-8">
                                        <p className="text-xs font-black text-slate-800 uppercase tracking-tighter leading-none transition-colors group-hover:text-teal-600">{e.code || 'None'}</p>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2 opacity-60">{e.category || 'General'}</p>
                                    </td>
                                    <td className="p-8">
                                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-none ml-1 opacity-60">
                                            {e.lastChanged ? format(parseISO(e.lastChanged), 'MMM d, h:mma') : 'SIGNAL static'}
                                        </p>
                                    </td>
                                    <td className="p-8 pr-12 text-right">
                                        <button
                                            onClick={() => handleLogAction(e, 'Email')}
                                            disabled={!!updatingId}
                                            className="h-10 px-8 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest bg-white hover:bg-slate-900 hover:text-white transition-all text-slate-400 active:scale-[0.98] shadow-sm active:shadow-inner"
                                        >
                                            Send Node
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default EstimatesPage;
