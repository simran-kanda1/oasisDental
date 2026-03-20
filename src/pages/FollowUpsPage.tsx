import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FollowUp, Patient } from '../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { logActivity } from '../lib/activityLogger';
import { cn } from '../lib/utils';

const PROCEDURE_CODES: Record<string, string> = {
    '7000': 'CBCT',
    '27000': 'Crown',
    '71101': 'Extraction',
    '79000': 'Implant Surgery',
    'IM00000020': 'MRI',
    '80000': 'Ortho',
    '40000': 'Perio/BG/Mem/GG',
    '23111': 'Resto',
    '0000': 'Hygiene'
};

const UI_ACTION_CLASSES = "h-9 px-4 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest flex items-center justify-center transition-all bg-white hover:bg-slate-50 text-slate-400 hover:text-teal-600 disabled:opacity-50 min-w-[80px] hover:border-teal-200 transition-all";

const FollowUpsPage: React.FC = () => {
    const { user, userProfile } = useAuth();
    const [followUps, setFollowUps] = useState<FollowUp[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [search, setSearch] = useState('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [bookingData, setBookingData] = useState({ date: '', type: '' });
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState('');

    useEffect(() => {
        const q = query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', false));
        const unsub = onSnapshot(q, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as FollowUp));
            data.sort((a, b) => (b.lastChanged || '0').localeCompare(a.lastChanged || '0'));
            setFollowUps(data);
            setLoading(false);
        });
        return unsub;
    }, []);

    const handleLogAction = async (f: FollowUp, type: string, extra?: string) => {
        setUpdatingId(f.id);
        const ref = doc(db, 'followUps', f.id);
        const updateData: any = {
            lastChanged: new Date().toISOString(),
            contactedBy: userProfile?.displayName ?? user?.email ?? 'User',
            outcome: extra ? `${type}: ${extra}` : type
        };
        if (type === 'Later' && extra) updateData.followUpDate = extra;
        await updateDoc(ref, updateData);
        await logActivity({
            userId: user!.uid,
            userEmail: user!.email!,
            userName: userProfile?.displayName ?? user!.email!,
            action: `Outreach: ${f.appointment.patient.name} - ${type}`,
            section: 'Follow-Ups'
        });
        setUpdatingId(null);
    };

    const handleSaveNote = async (id: string) => {
        await updateDoc(doc(db, 'followUps', id), {
            notes: noteDraft,
            lastChanged: new Date().toISOString()
        });
        setActiveNoteId(null);
        setNoteDraft('');
    };

    const handleCompleteBooking = async (f: FollowUp) => {
        if (!bookingData.date || !bookingData.type) return;
        setUpdatingId(f.id);
        await updateDoc(doc(db, 'followUps', f.id), {
            nextAppointmentBooked: true,
            nextAppointmentDate: bookingData.date,
            status: 'completed',
            lastChanged: new Date().toISOString(),
            outcome: `Booked: ${bookingData.type} on ${bookingData.date}`
        });
        setBookingId(null);
        setBookingData({ date: '', type: '' });
        setUpdatingId(null);
    };

    const handleCodeChange = async (id: string, newCode: string) => {
        await updateDoc(doc(db, 'followUps', id), {
            code: newCode,
            category: PROCEDURE_CODES[newCode],
            lastChanged: new Date().toISOString()
        });
    };

    const filtered = followUps.filter(f => f.appointment.patient.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="p-8 space-y-12 max-w-full mx-auto bg-white font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Follow Ups</h1>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">{followUps.length} Pending Registry Nodes</p>
                </div>
                <div className="relative w-full md:max-w-xs transition-all">
                    <Input
                        placeholder="Search Registry..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-6 h-12 bg-slate-50 border-slate-100 rounded-2xl text-[11px] font-black uppercase tracking-tight placeholder:text-slate-200 focus:bg-white focus:ring-teal-500/10 focus:border-teal-500 transition-all shadow-sm"
                    />
                </div>
            </div>

            {loading ? (
                <div className="p-40 text-center uppercase text-[10px] font-black opacity-10 tracking-[0.3em]">Syncing...</div>
            ) : (
                <div className="bg-white border border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden min-h-[500px]">
                    <div className="overflow-x-auto scrollbar-none">
                        <table className="w-full text-left border-collapse min-w-[1200px]">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100/50">
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] pl-10">Patient</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Code</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] text-center">Status</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Protocol</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Clinical Update</th>
                                    <th className="p-6 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] pr-10 text-right">Registry</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filtered.map(f => (
                                    <tr key={f.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="p-6 pl-10">
                                            <div className="text-xs font-black text-slate-900 uppercase tracking-tighter truncate leading-none">{f.appointment.patient.name}</div>
                                            <div className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-1.5 opacity-60 leading-none">{f.appointment.patient.id}</div>
                                        </td>
                                        <td className="p-6">
                                            <select className="h-9 px-4 rounded-xl bg-slate-50 text-[10px] font-black uppercase tracking-widest border border-slate-100 cursor-pointer w-full max-w-[150px] focus:bg-white focus:border-teal-300 transition-all outline-none" value={f.code || 'default'} onChange={(e) => handleCodeChange(f.id, e.target.value)}>
                                                <option value="default" disabled>Select Code</option>
                                                {Object.entries(PROCEDURE_CODES).map(([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}
                                            </select>
                                        </td>
                                        <td className="p-6 text-center">
                                            <div className="inline-flex flex-col items-center gap-2">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-slate-300 mb-1 opacity-60">Unbooked</div>
                                                <Button size="sm" onClick={() => setBookingId(f.id)} className="h-8 px-6 bg-slate-900 hover:bg-slate-800 text-white text-[9px] font-black uppercase tracking-widest rounded-xl shadow-xl shadow-slate-900/10 active:scale-[0.98] transition-all">Set Appt</Button>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex flex-wrap items-center gap-2 py-1">
                                                <button onClick={() => handleLogAction(f, 'Call')} disabled={!!updatingId} className={UI_ACTION_CLASSES}>Call</button>
                                                <button onClick={() => handleLogAction(f, 'VM')} disabled={!!updatingId} className={UI_ACTION_CLASSES}>VM</button>
                                                <button onClick={() => handleLogAction(f, 'Text')} disabled={!!updatingId} className={UI_ACTION_CLASSES}>Text</button>
                                                <div className="relative group/later">
                                                    <button onClick={() => { }} className={UI_ACTION_CLASSES}>Later</button>
                                                    <div className="absolute top-0 right-0 h-full opacity-0 pointer-events-none group-hover/later:opacity-100 group-hover/later:pointer-events-auto transition-all flex items-center pr-1 translate-x-4 group-hover/later:translate-x-0">
                                                        <Input type="date" onChange={e => handleLogAction(f, 'Later', e.target.value)} className="h-8 w-28 text-[9px] font-black bg-white border-teal-200 p-2 rounded-lg shadow-xl" />
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            <div className="max-w-[300px] flex flex-col gap-3">
                                                <div onClick={() => { setActiveNoteId(f.id); setNoteDraft(f.notes || ''); }} className="cursor-pointer group/note">
                                                    <p className={cn("text-[11px] font-bold uppercase tracking-tight leading-relaxed transition-colors", f.notes ? "text-slate-600" : "text-slate-200 italic group-hover/note:text-teal-400")}>
                                                        {f.notes || 'Append internal note...'}
                                                    </p>
                                                </div>
                                                <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100 flex items-center justify-between">
                                                    <p className="text-[9px] font-black text-slate-800 truncate uppercase tracking-tighter opacity-80 leading-none">{f.outcome || 'Signal Static'}</p>
                                                    <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest leading-none ml-4">
                                                        {f.lastChanged ? format(parseISO(f.lastChanged), 'HH:mm') : '00:00'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-6 pr-10 text-right">
                                            <div className="flex items-center justify-end gap-6 text-[10px] font-black uppercase tracking-widest text-slate-300">
                                                <button onClick={() => setSelectedPatient(f.appointment.patient as Patient)} className="hover:text-teal-600 transition-colors">File</button>
                                                <button className="hover:text-slate-900 transition-colors">Dentrix</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeNoteId && (
                <>
                    <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[100]" onClick={() => setActiveNoteId(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 z-[101] animate-in zoom-in-95 duration-200">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-8">Clinical Registry Update</h4>
                        <Input
                            autoFocus
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            placeholder="Type internal note..."
                            className="h-16 text-sm font-bold border-slate-100 bg-slate-50/50 rounded-2xl mb-8 focus:bg-white focus:ring-teal-500/10 transition-all"
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveNote(activeNoteId)}
                        />
                        <div className="flex gap-4">
                            <Button onClick={() => handleSaveNote(activeNoteId)} className="flex-1 h-12 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all active:scale-[0.98]">Confirm Note</Button>
                            <Button variant="ghost" onClick={() => setActiveNoteId(null)} className="flex-1 h-12 border border-slate-100 text-[10px] font-black uppercase tracking-widest rounded-xl">Cancel</Button>
                        </div>
                    </div>
                </>
            )}

            {bookingId && (
                <>
                    <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[100]" onClick={() => setBookingId(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 z-[101] animate-in zoom-in-95 duration-200">
                        <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.3em] mb-8 border-b pb-4 border-slate-50">Close Node</h3>
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Appointment Type</label>
                                <select className="w-full h-12 border border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase tracking-tight px-4 outline-none focus:bg-white focus:border-teal-300 transition-all" value={bookingData.type} onChange={e => setBookingData({ ...bookingData, type: e.target.value })}>
                                    <option value="" disabled>Select Registry Node</option>
                                    {Object.values(PROCEDURE_CODES).map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registry Date</label>
                                <Input type="date" value={bookingData.date} onChange={e => setBookingData({ ...bookingData, date: e.target.value })} className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl text-[11px] font-black uppercase transition-all focus:bg-white focus:ring-teal-500/10" />
                            </div>
                            <Button onClick={() => { const f = followUps.find(x => x.id === bookingId); if (f) handleCompleteBooking(f); }} disabled={!bookingData.date || !bookingData.type || !!updatingId} className="w-full h-14 bg-teal-600 hover:bg-teal-700 text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-2xl mt-4 shadow-xl shadow-teal-500/10 active:scale-[0.98] transition-all">Submit Registry Node</Button>
                            <Button variant="ghost" onClick={() => setBookingId(null)} className="w-full h-10 text-[10px] font-black text-slate-300 uppercase tracking-widest mt-2">Cancel</Button>
                        </div>
                    </div>
                </>
            )}

            {selectedPatient && (
                <>
                    <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[100]" onClick={() => setSelectedPatient(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-12 z-[101] animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-start border-b pb-6 mb-6 border-slate-50">
                            <div>
                                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter leading-none">{selectedPatient.name}</h3>
                                <p className="text-[9px] font-black text-teal-600 uppercase tracking-widest mt-2">{selectedPatient.id}</p>
                            </div>
                            <button onClick={() => setSelectedPatient(null)} className="text-[10px] font-black text-slate-300 uppercase hover:text-rose-500 transition-colors">Close</button>
                        </div>
                        <div className="space-y-6 text-xs mb-8">
                            <div className="flex justify-between border-b border-slate-50 pb-3">
                                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Phone Pulse</span>
                                <span className="font-black text-slate-900 uppercase tracking-tight">{selectedPatient.phone}</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-50 pb-3">
                                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Email Node</span>
                                <span className="font-black text-slate-900 uppercase tracking-tight truncate ml-8">{selectedPatient.email}</span>
                            </div>
                        </div>
                        <Button className="w-full h-14 bg-slate-900 hover:bg-slate-800 text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-2xl shadow-xl shadow-slate-900/10 active:scale-[0.98] transition-all">Deep File Access</Button>
                    </div>
                </>
            )}
        </div>
    );
};

export default FollowUpsPage;
