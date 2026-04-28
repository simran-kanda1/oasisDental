import React from 'react';
import { usePatientProfile } from '../contexts/PatientProfileContext';
import { cn } from '../lib/utils';

type Props = {
    patientId: string | number | undefined | null;
    className?: string;
    /** When false, still looks like text but does not open profile */
    disabled?: boolean;
    children: React.ReactNode;
};

/**
 * Clickable patient block — opens quick profile (phone, address, notes) from Firestore.
 */
export const PatientProfileTrigger: React.FC<Props> = ({ patientId, className, disabled, children }) => {
    const { openPatient } = usePatientProfile();
    const id = patientId != null && patientId !== '' ? String(patientId).trim() : '';

    if (!id || disabled) {
        return <span className={className}>{children}</span>;
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openPatient(id);
            }}
            className={cn(
                'text-left rounded-md px-1 -mx-1 py-0.5 -my-0.5 w-full max-w-full border-0 bg-transparent font-inherit uppercase tracking-inherit',
                'hover:bg-teal-50/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/35 transition-colors cursor-pointer',
                className
            )}
        >
            {children}
        </button>
    );
};
