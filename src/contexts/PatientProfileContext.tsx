import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { PatientQuickProfileModal } from '../components/PatientQuickProfileModal';

type PatientProfileContextValue = {
    openPatient: (patientId: string) => void;
    closePatient: () => void;
};

const PatientProfileContext = createContext<PatientProfileContextValue | null>(null);

export const PatientProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activePatientId, setActivePatientId] = useState<string | null>(null);

    const openPatient = useCallback((patientId: string) => {
        const id = patientId.trim();
        if (!id) return;
        setActivePatientId(id);
    }, []);

    const closePatient = useCallback(() => setActivePatientId(null), []);

    const value = useMemo(() => ({ openPatient, closePatient }), [openPatient, closePatient]);

    return (
        <PatientProfileContext.Provider value={value}>
            {children}
            {activePatientId ? (
                <PatientQuickProfileModal patientLookupId={activePatientId} onClose={closePatient} />
            ) : null}
        </PatientProfileContext.Provider>
    );
};

export function usePatientProfile(): PatientProfileContextValue {
    const ctx = useContext(PatientProfileContext);
    if (!ctx) {
        throw new Error('usePatientProfile must be used within PatientProfileProvider');
    }
    return ctx;
}
