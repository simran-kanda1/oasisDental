export type FollowUpStatus = 'called' | 'sent_message' | 'will_follow_up' | 'no_answer' | 'completed' | 'not_contacted' | 'estimate_followup';

export interface Patient {
    id: string;
    name: string;
    phone: string;
    email: string;
    mobile?: string;
    avatar?: string;
}

export interface Appointment {
    id: string;
    patient: Patient;
    date: string;
    time: string;
    type: string;
    code?: string; // Procedure code
    provider: string;
    status: 'confirmed' | 'pending' | 'cancelled' | 'completed' | 'no_show';
    estimateSent: boolean;
    estimateSentDate?: string;
    notes?: string;
}

export interface FollowUp {
    id: string;
    appointment: Appointment;
    status: FollowUpStatus;
    lastChanged: string;
    outcome?: string;
    followUpDate?: string;
    contactedBy?: string;
    notes?: string;
    code?: string; // Procedure code currently selected
    category?: string; // Categorized based on code
    nextAppointmentBooked: boolean;
    nextAppointmentDate?: string;
}

export interface WixInquiry {
    id: string;
    name: string;
    email: string;
    phone?: string;
    message: string;
    service: string;
    submittedAt: string;
    status: 'new' | 'in_progress' | 'responded' | 'converted';
    assignedTo?: string;
}

export interface EmailCampaign {
    id: string;
    month: string;
    year: number;
    subject: string;
    template: string;
    status: 'draft' | 'scheduled' | 'sent';
    scheduledDate?: string;
    sentDate?: string;
    openRate?: number;
    clickRate?: number;
}

export interface WeaveContact {
    id: string;
    name: string;
    phone: string;
    lastContact?: string;
    status: 'active' | 'inactive';
}
