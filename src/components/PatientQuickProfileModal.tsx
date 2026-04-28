import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { X, Phone, MapPin, Mail, Copy, User } from 'lucide-react';
import { db } from '../lib/firebase';
import { resolvePatientFirestoreDocId } from '../lib/resolvePatientFirestoreDoc';
import {
    cleanDentrixText,
    formatPatientAddressBlock,
    formatPatientFullName,
    getPatientBestPhone,
    getPatientNotesBlocks,
    isActiveDentrixPatient,
    type DentrixPatientDoc,
} from '../lib/dentrix';
import { Button } from './ui/button';

function usePatientDocSubscription(firestoreDocId: string | null) {
    const [patient, setPatient] = useState<DentrixPatientDoc | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!firestoreDocId) {
            setPatient(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        const unsub = onSnapshot(
            doc(db, 'patients', firestoreDocId),
            (snap) => {
                if (!snap.exists()) {
                    setPatient(null);
                } else {
                    setPatient({ id: snap.id, ...snap.data() } as DentrixPatientDoc);
                }
                setLoading(false);
            },
            () => {
                setPatient(null);
                setLoading(false);
            }
        );
        return unsub;
    }, [firestoreDocId]);

    return { patient, loading };
}

async function copyText(label: string, text: string) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        window.prompt(`Copy ${label}`, text);
    }
}

export type PatientQuickProfileModalProps = {
    patientLookupId: string;
    onClose: () => void;
};

export const PatientQuickProfileModal: React.FC<PatientQuickProfileModalProps> = ({ patientLookupId, onClose }) => {
    const [resolvedDocId, setResolvedDocId] = useState<string | null>(null);
    const [resolveError, setResolveError] = useState(false);
    const [resolvingLookup, setResolvingLookup] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setResolvedDocId(null);
        setResolveError(false);
        setResolvingLookup(true);
        (async () => {
            const id = await resolvePatientFirestoreDocId(db, patientLookupId);
            if (cancelled) return;
            setResolvingLookup(false);
            if (!id) {
                setResolveError(true);
                setResolvedDocId(null);
            } else {
                setResolvedDocId(id);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [patientLookupId]);

    const { patient, loading } = usePatientDocSubscription(resolvedDocId);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const displayName = patient
        ? formatPatientFullName(patient.first_name, patient.last_name) || `Patient #${patient.patient_id ?? patient.id}`
        : `Patient #${patientLookupId}`;

    const address = patient ? formatPatientAddressBlock(patient) : null;
    const notesBlocks = patient ? getPatientNotesBlocks(patient) : [];
    const mobile = patient ? cleanDentrixText(patient.mobile_phone) : '';
    const home = patient ? cleanDentrixText(patient.home_phone) : '';
    const email = patient ? cleanDentrixText(patient.email) : '';
    const active = patient ? isActiveDentrixPatient(patient) : true;

    return (
        <>
            <div className="fixed inset-0 bg-slate-900/40 z-[200] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
            <div
                role="dialog"
                aria-modal
                aria-labelledby="patient-profile-title"
                className="fixed left-1/2 top-1/2 z-[201] w-[min(100vw-1.5rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white shadow-2xl max-h-[min(90vh,32rem)] flex flex-col overflow-hidden"
            >
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3 shrink-0">
                    <div className="min-w-0 flex items-start gap-2">
                        <div className="mt-0.5 rounded-lg bg-teal-100 p-1.5 text-teal-700">
                            <User size={16} />
                        </div>
                        <div className="min-w-0">
                            <h2 id="patient-profile-title" className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">
                                {displayName}
                            </h2>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                Dentrix ID {patientLookupId}
                                {patient?.patient_guid ? ` · ${cleanDentrixText(patient.patient_guid).slice(0, 8)}…` : ''}
                            </p>
                            {!active && (
                                <span className="mt-1 inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                                    Inactive in Dentrix
                                </span>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
                    {resolvingLookup || (loading && !resolveError && resolvedDocId) ? (
                        <p className="text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest py-8">Loading patient…</p>
                    ) : resolveError || !patient ? (
                        <div className="rounded-lg border border-amber-100 bg-amber-50/80 p-3 text-[11px] text-amber-900">
                            <p className="font-bold">No synced patient record found.</p>
                            <p className="mt-1 text-amber-800/90 leading-snug">
                                This ID may not be in Firestore yet, or the patient document uses a different key. Staff can still use Dentrix for full details.
                            </p>
                        </div>
                    ) : (
                        <>
                            <section>
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Contact</p>
                                <div className="space-y-2">
                                    {!mobile && !home ? (
                                        <p className="rounded-lg border border-slate-100 bg-slate-50/50 p-2 text-xs text-slate-500">No phone numbers on file.</p>
                                    ) : null}
                                    {(mobile || home) && (
                                        <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                                            <Phone size={14} className="mt-0.5 shrink-0 text-teal-600" />
                                            <div className="min-w-0 flex-1 space-y-1">
                                                {mobile ? (
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-[11px] font-semibold text-slate-800">Mobile</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 px-2 text-[10px] font-bold uppercase"
                                                            onClick={() => copyText('mobile', mobile)}
                                                        >
                                                            <Copy size={12} className="mr-1" />
                                                            Copy
                                                        </Button>
                                                    </div>
                                                ) : null}
                                                {mobile ? <p className="text-xs text-slate-700 tabular-nums">{mobile}</p> : null}
                                                {home ? (
                                                    <>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase pt-1">Home</p>
                                                        <p className="text-xs text-slate-700 tabular-nums">{home}</p>
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    )}
                                    {email ? (
                                        <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                                            <Mail size={14} className="mt-0.5 shrink-0 text-teal-600" />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-[11px] font-semibold text-slate-800">Email</span>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2 text-[10px] font-bold uppercase"
                                                        onClick={() => copyText('email', email)}
                                                    >
                                                        <Copy size={12} className="mr-1" />
                                                        Copy
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-slate-700 break-all">{email}</p>
                                            </div>
                                        </div>
                                    ) : null}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-full h-8 text-[10px] font-bold uppercase"
                                        onClick={() => copyText('phone', getPatientBestPhone(patient))}
                                    >
                                        Copy best phone ({getPatientBestPhone(patient)})
                                    </Button>
                                </div>
                            </section>

                            <section>
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1">
                                    <MapPin size={10} />
                                    Address
                                </p>
                                {address ? (
                                    <p className="whitespace-pre-line rounded-lg border border-slate-100 bg-white p-2 text-xs text-slate-700 leading-relaxed">
                                        {address}
                                    </p>
                                ) : (
                                    <p className="text-xs text-slate-500 italic">No address on file in sync.</p>
                                )}
                            </section>

                            {cleanDentrixText(patient.birth_date) ? (
                                <section>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Birth date</p>
                                    <p className="text-xs text-slate-700">{cleanDentrixText(patient.birth_date)}</p>
                                </section>
                            ) : null}

                            {cleanDentrixText(patient.preferred_contact_method) ? (
                                <section>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Preferred contact</p>
                                    <p className="text-xs text-slate-700">{cleanDentrixText(patient.preferred_contact_method)}</p>
                                </section>
                            ) : null}

                            <section>
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Notes on record</p>
                                {notesBlocks.length === 0 ? (
                                    <p className="text-xs text-slate-500 italic">No notes synced for this patient.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {notesBlocks.map((b) => (
                                            <div key={b.label} className="rounded-lg border border-slate-100 bg-slate-50/40 p-2">
                                                <p className="text-[10px] font-black uppercase text-teal-700">{b.label}</p>
                                                <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{b.text}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            {typeof patient.num_of_missed_appointments === 'number' ? (
                                <section className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                    <p className="text-[10px] font-black uppercase text-slate-500">Missed appointments (sync)</p>
                                    <p className="text-lg font-black text-slate-900">{patient.num_of_missed_appointments}</p>
                                </section>
                            ) : null}
                        </>
                    )}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-2 shrink-0">
                    <Button type="button" className="w-full h-9 text-[10px] font-black uppercase bg-slate-900 hover:bg-slate-800" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </>
    );
};
