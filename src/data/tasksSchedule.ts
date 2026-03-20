export interface RecurringTask {
    id: string;
    title: string;
    description?: string;
    day: number; // 1 (Mon) to 6 (Sat)
    week: number; // 1 to 4
}

export const RECURRING_TASKS: RecurringTask[] = [
    // WEEK 1
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w1d${day}-gr`, title: 'GOOGLE REVIEW', day, week: 1 })),
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w1d${day}-ce`, title: 'CALL EMERGENCY PATIENT 7 DAYS AGO (MISC LETTER)', day, week: 1 })),
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w1d${day}-uns`, title: 'Unschedule/No Show (PREVIOUS DAY + 1 WEEK AGO)', day, week: 1 })),
    { id: 'w1d1-uns-next', title: 'Unschedule/No Show (NEXT DAY + 1 WEEK AGO)', day: 1, week: 1 },
    { id: 'w1d1-hyg-next', title: 'CC HYG UNBOOKED - DUE NEXT MONTH (CC APPOINTMENT BOOK)', day: 1, week: 1 },
    { id: 'w1d1-hyg-this', title: 'CC HYG UNBOOKED DUE THIS MONTH (CC APPOINTMENT BOOK)', day: 1, week: 1 },
    { id: 'w1d1-predet', title: 'CC PREDET (LAST MONTH) (CC APPOINTMENT BOOK)', day: 1, week: 1 },
    { id: 'w1d2-resto-last', title: 'TREATMENT PLANNER - RESTO (LAST MONTH) - CALL (TREATMENT MANAGER)', day: 2, week: 1 },
    { id: 'w1d2-resto-2m', title: 'TREATMENT PLANNER - RESTO (2 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 2, week: 1 },
    { id: 'w1d2-resto-5m', title: 'TREATMENT PLANNER - RESTO (5 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 2, week: 1 },
    { id: 'w1d2-resto-7m', title: 'TREATMENT PLANNER - RESTO (7 MONTHS AGO) - EMAIL / TEXT / CALL (TREATMENT MANAGER)', day: 2, week: 1 },
    { id: 'w1d6-ortho-predet', title: 'Ortho Predet', day: 6, week: 1 },
    { id: 'w1d6-tmj-predet', title: 'TMJ Predet', day: 6, week: 1 },
    { id: 'w1d6-mri-fu', title: 'MRI F/U', day: 6, week: 1 },
    { id: 'w1d6-ortho-recare', title: 'Ortho Recare', day: 6, week: 1 },
    { id: 'w1d6-np-review', title: 'NEW PATIENT REVIEW (NP/EMERG/CONSULTS (Implant/Ortho/ZOOM)', day: 6, week: 1 },
    { id: 'w1d6-ref-thank', title: 'REFERAL THANK YOU ($5) - LAST WEEK (MISC LETTER)', day: 6, week: 1 },

    // WEEK 2
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w2d${day}-gr`, title: 'GOOGLE REVIEW', day, week: 2 })),
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w2d${day}-ce`, title: 'CALL EMERGENCY PATIENT 7 DAYS AGO (MISC LETTER)', day, week: 2 })),
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w2d${day}-uns`, title: 'Unschedule/No Show (PREVIOUS DAY + 1 WEEK AGO)', day, week: 2 })),
    { id: 'w2d1-uns-next', title: 'Unschedule/No Show (NEXT DAY + 1 WEEK AGO)', day: 1, week: 2 },
    { id: 'w2d1-hyg-3m', title: 'CC HYG UNBOOKED - OVERDUE 3M (CC APPOINTMENT BOOK)', day: 1, week: 2 },
    { id: 'w2d3-tx-2m', title: 'TREATMENT PLANNER + TX LETTER - CROWN BRIDGE/EXTRACTION/ IMPLANT/ROOT CANAL (2 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 3, week: 2 },
    { id: 'w2d3-tx-3m', title: 'TREATMENT PLANNER + TX LETTER - CROWN BRIDGE/EXTRACTION/ IMPLANT/ROOT CANAL (3 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 3, week: 2 },
    { id: 'w2d3-tx-4m', title: 'TREATMENT PLANNER + TX LETTER - CROWN BRIDGE/EXTRACTION/ IMPLANT/ROOT CANAL (4 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 3, week: 2 },
    { id: 'w2d5-predet-2m', title: 'CC PREDET (2 MONTHS AGO) (CC APPOINTMENT BOOK)', day: 5, week: 2 },
    { id: 'w2d6-np-review', title: 'NEW PATIENT REVIEW (NP/EMERG/CONSULTS (Implant/Ortho/ZOOM)', day: 6, week: 2 },
    { id: 'w2d6-ref-thank', title: 'REFERAL THANK YOU ($5) - LAST WEEK (MISC LETTER)', day: 6, week: 2 },

    // WEEK 3
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w3d${day}-gr`, title: 'GOOGLE REVIEW', day, week: 3 })),
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w3d${day}-ce`, title: 'CALL EMERGENCY PATIENT 7 DAYS AGO (MISC LETTER)', day, week: 3 })),
    ...[1, 2, 3, 4, 5, 6].map(day => ({ id: `w3d${day}-uns`, title: 'Unschedule/No Show (PREVIOUS DAY + 1 WEEK AGO)', day, week: 3 })),
    { id: 'w3d1-uns-next', title: 'Unschedule/No Show (NEXT DAY + 1 WEEK AGO)', day: 1, week: 3 },
    { id: 'w3d1-hyg-6m', title: 'CC HYG UNBOOKED - OVERDUE 6M (CC APPOINTMENT BOOK)', day: 1, week: 3 },
    { id: 'w3d1-hyg-9m', title: 'CC HYG UNBOOKED - OVERDUE 9M (CC APPOINTMENT BOOK)', day: 1, week: 3 },
    { id: 'w3d1-hyg-12m', title: 'CC HYG UNBOOKED - OVERDUE 12M (RAJ LIST TO CALL)', day: 1, week: 3 },
    { id: 'w3d3-cbct-1m', title: 'TREATMENT PLANNER - CBCT/ PERIO (1 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 3, week: 3 },
    { id: 'w3d3-cbct-2m', title: 'TREATMENT PLANNER - CBCT/ PERIO (2 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 3, week: 3 },
    { id: 'w3d3-cbct-3m', title: 'TREATMENT PLANNER - CBCT/ PERIO (3 MONTHS AGO) - CALL (TREATMENT MANAGER)', day: 3, week: 3 },
    { id: 'w3d5-predet-3m', title: 'CC PREDET (3 MONTHS AGO) (CC APPOINTMENT BOOK)', day: 5, week: 3 },
    { id: 'w3d6-np-review', title: 'NEW PATIENT REVIEW (NP/EMERG/CONSULTS (Implant/Ortho/ZOOM)', day: 6, week: 3 },
    { id: 'w3d6-ref-thank', title: 'REFERAL THANK YOU ($5) - LAST WEEK (MISC LETTER)', day: 6, week: 3 },

    // WEEK 4
    ...[4, 5, 6].map(day => ({ id: `w4d${day}-gr`, title: 'GOOGLE REVIEW', day, week: 4 })),
    ...[4, 5, 6].map(day => ({ id: `w4d${day}-ce`, title: 'CALL EMERGENCY PATIENT 7 DAYS AGO (MISC LETTER)', day, week: 4 })),
    ...[4, 5, 6].map(day => ({ id: `w4d${day}-uns`, title: 'Unschedule/No Show (PREVIOUS DAY + 1 WEEK AGO)', day, week: 4 })),
    { id: 'w4d1-uns-next', title: 'Unschedule/No Show (NEXT DAY + 1 WEEK AGO)', day: 1, week: 4 },
    { id: 'w4d2-ce', title: 'CALL EMERGENCY PATIENT (MISC LETTER)', day: 2, week: 4 },
    { id: 'w4d6-np-review', title: 'NEW PATIENT REVIEW (NP/EMERG/CONSULTS (Implant/Ortho/ZOOM)', day: 6, week: 4 },
    { id: 'w4d6-ref-thank', title: 'REFERAL THANK YOU ($5) - LAST WEEK (MISC LETTER)', day: 6, week: 4 },
];
