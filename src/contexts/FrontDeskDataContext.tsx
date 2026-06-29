import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit, where } from 'firebase/firestore';
import { format, startOfDay } from 'date-fns';
import { db } from '../lib/firebase';
import { APPOINTMENTS_QUERY_LIMIT, FUTURE_APPOINTMENTS_QUERY_LIMIT, mergeAppointmentsById } from '../lib/appointmentsQuery';
import { fetchLedgerForPatients } from '../lib/ledgerTransactions';
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import { collectLedgerPatientIds } from '../lib/ledgerPatientIds';
import { QUEUE_ROW_TRACKING_COLLECTION, type QueueRowTrackingDoc } from '../lib/queueRowTracking';
import type { DentrixAppointmentDoc, DentrixPatientAppointmentInfoDoc, DentrixPatientDoc } from '../lib/dentrix';
import type { DentrixProcedureCodeDoc } from '../lib/procedureCodeTypes';

export interface FrontDeskDataState {
  allAppointments: DentrixAppointmentDoc[];
  patientsById: Record<string, DentrixPatientDoc>;
  patientInfoById: Record<string, DentrixPatientAppointmentInfoDoc>;
  procedureCodes: DentrixProcedureCodeDoc[];
  trackingByApptId: Record<string, QueueRowTrackingDoc>;
  ledgerByPatientId: Map<number, DentrixLedgerTransactionDoc[]>;
  appointmentsLoading: boolean;
  ledgerLoading: boolean;
}

const defaultState: FrontDeskDataState = {
  allAppointments: [],
  patientsById: {},
  patientInfoById: {},
  procedureCodes: [],
  trackingByApptId: {},
  ledgerByPatientId: new Map(),
  appointmentsLoading: true,
  ledgerLoading: false,
};

const FrontDeskDataContext = createContext<FrontDeskDataState>(defaultState);

export const FrontDeskDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [futureAppointments, setFutureAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
  const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
  const [procedureCodes, setProcedureCodes] = useState<DentrixProcedureCodeDoc[]>([]);
  const [trackingByApptId, setTrackingByApptId] = useState<Record<string, QueueRowTrackingDoc>>({});
  const [ledgerByPatientId, setLedgerByPatientId] = useState<Map<number, DentrixLedgerTransactionDoc[]>>(
    new Map()
  );
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const allAppointments = useMemo(
    () => mergeAppointmentsById(appointments, futureAppointments),
    [appointments, futureAppointments]
  );

  useEffect(() => {
    const todayStart = format(startOfDay(new Date()), "yyyy-MM-dd'T'00:00:00'Z'");
    const unsubA = onSnapshot(
      query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(APPOINTMENTS_QUERY_LIMIT)),
      (snap) => {
        setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
        setAppointmentsLoading(false);
      }
    );
    const unsubFuture = onSnapshot(
      query(
        collection(db, 'appointments'),
        where('appointment_date', '>=', todayStart),
        orderBy('appointment_date', 'asc'),
        limit(FUTURE_APPOINTMENTS_QUERY_LIMIT)
      ),
      (snap) => setFutureAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)))
    );
    const unsubP = onSnapshot(collection(db, 'patients'), (snap) => {
      const map: Record<string, DentrixPatientDoc> = {};
      snap.docs.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
        map[String(row.patient_id ?? row.id)] = row;
      });
      setPatientsById(map);
    });
    const unsubInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
      const map: Record<string, DentrixPatientAppointmentInfoDoc> = {};
      snap.docs.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc;
        map[String(row.patient_id ?? row.id)] = row;
      });
      setPatientInfoById(map);
    });
    const unsubProc = onSnapshot(collection(db, 'procedure_codes'), (snap) => {
      setProcedureCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixProcedureCodeDoc)));
    });
    const unsubTracking = onSnapshot(collection(db, QUEUE_ROW_TRACKING_COLLECTION), (snap) => {
      const map: Record<string, QueueRowTrackingDoc> = {};
      snap.docs.forEach((d) => {
        map[d.id] = { ...(d.data() as QueueRowTrackingDoc), appointmentId: d.id };
      });
      setTrackingByApptId(map);
    });
    return () => {
      unsubA();
      unsubFuture();
      unsubP();
      unsubInfo();
      unsubProc();
      unsubTracking();
    };
  }, []);

  useEffect(() => {
    const ids = collectLedgerPatientIds(allAppointments);
    if (!ids.length) {
      setLedgerByPatientId(new Map());
      setLedgerLoading(false);
      return;
    }

    let cancelled = false;
    setLedgerLoading(true);
    void fetchLedgerForPatients(ids)
      .then((map) => {
        if (!cancelled) setLedgerByPatientId(map);
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allAppointments]);

  const value = useMemo<FrontDeskDataState>(
    () => ({
      allAppointments,
      patientsById,
      patientInfoById,
      procedureCodes,
      trackingByApptId,
      ledgerByPatientId,
      appointmentsLoading,
      ledgerLoading,
    }),
    [
      allAppointments,
      patientsById,
      patientInfoById,
      procedureCodes,
      trackingByApptId,
      ledgerByPatientId,
      appointmentsLoading,
      ledgerLoading,
    ]
  );

  return <FrontDeskDataContext.Provider value={value}>{children}</FrontDeskDataContext.Provider>;
};

export function useFrontDeskData(): FrontDeskDataState {
  return useContext(FrontDeskDataContext);
}
