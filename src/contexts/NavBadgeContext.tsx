import React, { createContext, startTransition, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import {
  buildDocIdToPatientIdMap,
  buildDocumentEstimateWorkItems,
  filterEstimateCandidateDocuments,
  fetchEstimateDocuments,
  ESTIMATE_DOCUMENTS_BADGE_LIMIT,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK,
} from '../lib/documentEstimates';
import { fetchAttachmentsForDocIds } from '../lib/documentAttachments';
import {
  computeFrontDeskQueueCounts,
  frontDeskQueueTotal,
} from '../lib/navBadgeCounts';
import { APPOINTMENTS_QUERY_LIMIT, FUTURE_APPOINTMENTS_QUERY_LIMIT, mergeAppointmentsById } from '../lib/appointmentsQuery';
import { format, startOfDay } from 'date-fns';
import { fetchLedgerForPatients } from '../lib/ledgerTransactions';
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import { QUEUE_ROW_TRACKING_COLLECTION, type QueueRowTrackingDoc } from '../lib/queueRowTracking';
import type { DentrixAppointmentDoc, DentrixPatientAppointmentInfoDoc, DentrixPatientDoc } from '../lib/dentrix';
import type { DentrixProcedureCodeDoc } from '../lib/procedureCodeTypes';

const BADGE_LEDGER_PATIENT_CAP = 2500;

export interface NavBadgeState {
  openInquiries: number;
  hiddenInquiries: number;
  estimatePredApproved: number;
  estimatePredFollowUp: number;
  frontDeskTotal: number;
  frontDeskByQueue: Record<string, number>;
  badgesReady: boolean;
  estimatesReady: boolean;
}

const defaultState: NavBadgeState = {
  openInquiries: 0,
  hiddenInquiries: 0,
  estimatePredApproved: 0,
  estimatePredFollowUp: 0,
  frontDeskTotal: 0,
  frontDeskByQueue: {},
  badgesReady: false,
  estimatesReady: false,
};

const NavBadgeContext = createContext<NavBadgeState>(defaultState);

export const NavBadgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openInquiries, setOpenInquiries] = useState(0);
  const [hiddenInquiries, setHiddenInquiries] = useState(0);
  const [estimatePredApproved, setEstimatePredApproved] = useState(0);
  const [estimatePredFollowUp, setEstimatePredFollowUp] = useState(0);
  const [estimatesReady, setEstimatesReady] = useState(false);
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [futureAppointments, setFutureAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
  const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
  const [procedureCodes, setProcedureCodes] = useState<DentrixProcedureCodeDoc[]>([]);
  const [trackingByApptId, setTrackingByApptId] = useState<Record<string, QueueRowTrackingDoc>>({});
  const [ledgerByPatientId, setLedgerByPatientId] = useState<Map<number, DentrixLedgerTransactionDoc[]>>(new Map());
  const [frontDeskByQueue, setFrontDeskByQueue] = useState<Record<string, number>>({});
  const [badgesReady, setBadgesReady] = useState(false);

  useEffect(() => {
    return onSnapshot(collection(db, 'wixInquiries'), (snap) => {
      let open = 0;
      let hidden = 0;
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (data.phoneMatchExcluded === true) {
          hidden += 1;
          return;
        }
        if (isOpenWixInquiryDoc(data)) open += 1;
      });
      setOpenInquiries(open);
      setHiddenInquiries(hidden);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadEstimateBadges = () => {
      setEstimatesReady(false);
      void fetchEstimateDocuments(db, ESTIMATE_DOCUMENTS_BADGE_LIMIT, { stopAtLookback: true })
        .then((documents) => {
          if (cancelled) return;
          const candidates = filterEstimateCandidateDocuments(documents, DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK);
          const docIds = candidates
            .map((d) => Number(d.docid ?? d.id))
            .filter((id) => Number.isFinite(id) && id > 0);

          if (docIds.length === 0) {
            startTransition(() => {
              setEstimatePredApproved(0);
              setEstimatePredFollowUp(0);
            });
            return;
          }

          return fetchAttachmentsForDocIds(db, docIds).then((attachments) => {
            if (cancelled) return;
            const docIdToPatientId = buildDocIdToPatientIdMap(attachments);
            const items = buildDocumentEstimateWorkItems(documents, docIdToPatientId, {}, {
              lookback: DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK,
            });
            startTransition(() => {
              setEstimatePredApproved(items.filter((i) => isPredApprovedDocumentStatus(i.workflowStatus)).length);
              setEstimatePredFollowUp(
                items.filter((i) => isPredFollowUpDocumentStatus(i.workflowStatus)).length
              );
            });
          });
        })
        .catch((err) => {
          console.error('estimate documents fetch failed', err);
        })
        .finally(() => {
          if (!cancelled) setEstimatesReady(true);
        });
    };

    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(loadEstimateBadges, { timeout: 4000 });
      } else {
        loadEstimateBadges();
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const allAppointments = useMemo(
    () => mergeAppointmentsById(appointments, futureAppointments),
    [appointments, futureAppointments]
  );

  useEffect(() => {
    const todayStart = format(startOfDay(new Date()), "yyyy-MM-dd'T'00:00:00'Z'");
    const unsubA = onSnapshot(
      query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(APPOINTMENTS_QUERY_LIMIT)),
      (snap) => setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)))
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
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const a of allAppointments) {
      const pid = String(a.patient_id ?? '');
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      ids.push(pid);
      if (ids.length >= BADGE_LEDGER_PATIENT_CAP) break;
    }
    if (!ids.length) {
      setLedgerByPatientId(new Map());
      return;
    }

    let cancelled = false;
    void fetchLedgerForPatients(ids).then((map) => {
      if (!cancelled) setLedgerByPatientId(map);
    });
    return () => {
      cancelled = true;
    };
  }, [allAppointments]);

  // Defer badge counts so Firestore snapshots cannot block auth / first paint.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const run = () => {
        const counts = computeFrontDeskQueueCounts(allAppointments, patientsById, patientInfoById, new Date(), {
          procedureCodes,
          ledgerByPatientId,
          trackingByApptId,
          patientInfoById,
        });
        if (!cancelled) {
          startTransition(() => {
            setFrontDeskByQueue(counts);
            setBadgesReady(true);
          });
        }
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 3000 });
      } else {
        run();
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allAppointments, patientsById, patientInfoById, procedureCodes, ledgerByPatientId, trackingByApptId]);

  const value = useMemo<NavBadgeState>(
    () => ({
      openInquiries,
      hiddenInquiries,
      estimatePredApproved,
      estimatePredFollowUp,
      frontDeskByQueue,
      frontDeskTotal: frontDeskQueueTotal(frontDeskByQueue),
      badgesReady,
      estimatesReady,
    }),
    [openInquiries, hiddenInquiries, estimatePredApproved, estimatePredFollowUp, frontDeskByQueue, badgesReady, estimatesReady]
  );

  return <NavBadgeContext.Provider value={value}>{children}</NavBadgeContext.Provider>;
};

export function useNavBadges(): NavBadgeState {
  return useContext(NavBadgeContext);
}
