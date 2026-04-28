import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { format, startOfWeek, addDays, isSameDay, endOfDay } from 'date-fns';
import { cn } from '../lib/utils';
import type { DentrixAppointmentDoc } from '../lib/dentrix';
import { cleanDentrixText, formatDentrixDateKey, formatDentrixTimeLabel } from '../lib/dentrix';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';

const AppointmentsPage: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
    const [loading, setLoading] = useState(true);

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const hours = Array.from({ length: 11 }, (_, i) => i + 8);
    const weekDays = Array.from({ length: 11 }, (_, i) => addDays(weekStart, i)).slice(0, 6);

    useEffect(() => {
        const rangeStart = `${format(weekStart, "yyyy-MM-dd")}T00:00:00Z`;
        const rangeEnd = endOfDay(addDays(weekStart, 5)).toISOString();
        const q = query(
            collection(db, 'appointments'),
            where('appointment_date', '>=', rangeStart),
            where('appointment_date', '<=', rangeEnd),
            orderBy('appointment_date', 'asc')
        );
        const unsub = onSnapshot(q, (snap) => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc));
            data.sort((a, b) => {
                const aHour = a.start_hour ?? 0;
                const bHour = b.start_hour ?? 0;
                const aMinute = a.start_minute ?? 0;
                const bMinute = b.start_minute ?? 0;
                if (aHour !== bHour) return aHour - bHour;
                return aMinute - bMinute;
            });
            setAppointments(data);
            setLoading(false);
        });
        return unsub;
    }, [weekStart]);

    const getAppointmentsForSlot = (date: Date, hour: number) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return appointments.filter(appt => {
            const apptDate = formatDentrixDateKey(appt.appointment_date);
            return apptDate === dateStr && (appt.start_hour ?? -1) === hour;
        });
    };

    return (
        <div className="p-8 space-y-12 max-w-full mx-auto bg-slate-50/50 font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b pb-8 border-slate-100 px-2">
                <div className="flex items-center gap-6">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">
                            {format(weekStart, 'MMMM yyyy')}
                        </h1>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mt-2">Clinic Queue Node</p>
                    </div>
                    <div className="flex items-center bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden p-1">
                        <Button variant="ghost" className="h-9 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 rounded-xl" onClick={() => setCurrentDate(addDays(currentDate, -7))}>Back</Button>
                        <Button variant="ghost" className="h-9 px-6 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-teal-600 rounded-xl bg-slate-50 border border-slate-100 mx-1" onClick={() => setCurrentDate(new Date())}>Today</Button>
                        <Button variant="ghost" className="h-9 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 rounded-xl" onClick={() => setCurrentDate(addDays(currentDate, 7))}>Next</Button>
                    </div>
                </div>
                <div className="bg-teal-50 px-4 h-12 rounded-2xl border border-teal-100 text-[10px] font-black uppercase tracking-[0.2em] text-teal-700 flex items-center">
                    Live Dentrix Schedule
                </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden shadow-teal-500/5">
                <div className="grid grid-cols-[80px_repeat(6,1fr)] border-b bg-slate-50">
                    <div className="p-4 border-r border-slate-100/50" />
                    {weekDays.map((day, i) => (
                        <div key={i} className={cn("p-6 text-center border-r border-slate-100/50 last:border-0 transition-colors", isSameDay(day, new Date()) ? "bg-teal-50/30" : "")}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">{format(day, 'EEE')}</p>
                            <p className={cn("text-2xl font-black mt-1.5 leading-none", isSameDay(day, new Date()) ? "text-teal-600" : "text-slate-900")}>
                                {format(day, 'd')}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-none">
                    {loading ? (
                        <div className="p-40 text-center uppercase text-[10px] font-black opacity-10 tracking-[0.3em]">Syncing...</div>
                    ) : (
                        hours.map((hour) => (
                            <div key={hour} className="grid grid-cols-[80px_repeat(6,1fr)] border-b border-slate-50 last:border-0 min-h-[140px] group">
                                <div className="p-6 border-r border-slate-50 bg-slate-50/20 text-[10px] font-black text-slate-200 text-center uppercase tracking-widest flex items-start justify-center pt-8 group-hover:bg-slate-50 transition-colors">
                                    {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                                </div>
                                {weekDays.map((day, dayIdx) => (
                                    <div key={dayIdx} className={cn("p-3 border-r border-slate-50 last:border-0 min-h-[140px] transition-colors", isSameDay(day, new Date()) ? "bg-teal-50/5" : "hover:bg-slate-50/30")}>
                                        <div className="space-y-4">
                                            {getAppointmentsForSlot(day, hour).map((appt) => (
                                                <Card key={appt.id} className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-xl hover:scale-[1.02] hover:border-teal-200 transition-all border-l-4 border-l-teal-600 overflow-hidden">
                                                    <PatientProfileTrigger
                                                        patientId={appt.patient_id != null ? String(appt.patient_id) : null}
                                                        className="mb-2 cursor-pointer"
                                                    >
                                                        <p className="text-[11px] font-black text-slate-900 uppercase tracking-tighter leading-none truncate">
                                                            {cleanDentrixText(appt.patient_name) || 'Unknown Patient'}
                                                        </p>
                                                    </PatientProfileTrigger>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none opacity-60 truncate">
                                                        {cleanDentrixText(appt.reason) || 'General Appointment'}
                                                    </p>
                                                    <div className="mt-3 pt-3 border-t border-slate-50 flex items-center justify-between opacity-30 italic">
                                                        <span className="text-[8px] font-black uppercase tracking-[0.2em]">
                                                            {cleanDentrixText(appt.provider_id) || 'UNASSIGNED'}
                                                        </span>
                                                        <span className="text-[8px] font-black uppercase tracking-[0.2em]">
                                                            {formatDentrixTimeLabel(appt.start_hour, appt.start_minute)}
                                                        </span>
                                                    </div>
                                                </Card>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default AppointmentsPage;
