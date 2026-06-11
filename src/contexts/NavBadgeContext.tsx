import React, { createContext, startTransition, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isOpenWixInquiryDoc } from '../lib/wixInquiryCounts';
import {
  buildDocIdToPatientIdMap,
  buildDocumentEstimateWorkItems,
  filterEstimateCandidateDocuments,
  estimateDocumentsFirestoreQuery,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK,
} from '../lib/documentEstimates';
import { fetchAttachmentsForDocIds } from '../lib/documentAttachments';
import type { DentrixDocumentDoc } from '../lib/documentEstimates';
import {
  computeFrontDeskQueueCounts,
  frontDeskQueueTotal,
} from '../lib/navBadgeCounts';
import type { DentrixAppointmentDoc, DentrixPatientAppointmentInfoDoc, DentrixPatientDoc } from '../lib/dentrix';
import type { DentrixProcedureCodeDoc } from '../lib/procedureCodeTypes';

export interface NavBadgeState {
  openInquiries: number;
  hiddenInquiries: number;
  estimatePredApproved: number;
  estimatePredFollowUp: number;
  frontDeskTotal: number;
  frontDeskByQueue: Record<string, number>;
}

const defaultState: NavBadgeState = {
  openInquiries: 0,
  hiddenInquiries: 0,
  estimatePredApproved: 0,
  estimatePredFollowUp: 0,
  frontDeskTotal: 0,
  frontDeskByQueue: {},
};

const NavBadgeContext = createContext<NavBadgeState>(defaultState);

export const NavBadgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openInquiries, setOpenInquiries] = useState(0);
  const [hiddenInquiries, setHiddenInquiries] = useState(0);
  const [estimatePredApproved, setEstimatePredApproved] = useState(0);
  const [estimatePredFollowUp, setEstimatePredFollowUp] = useState(0);
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
  const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
  const [procedureCodes, setProcedureCodes] = useState<DentrixProcedureCodeDoc[]>([]);
  const [frontDeskByQueue, setFrontDeskByQueue] = useState<Record<string, number>>({});

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
    const documentsQuery = estimateDocumentsFirestoreQuery(db, DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK);
    let cancelled = false;

    const unsub = onSnapshot(
      documentsQuery,
      (snap) => {
        const documents = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixDocumentDoc));
        const candidates = filterEstimateCandidateDocuments(documents, DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK);
        const docIds = candidates
          .map((d) => Number(d.docid ?? d.id))
          .filter((id) => Number.isFinite(id) && id > 0);

        void fetchAttachmentsForDocIds(db, docIds)
          .then((attachments) => {
            if (cancelled) return;
            const docIdToPatientId = buildDocIdToPatientIdMap(attachments);
            const items = buildDocumentEstimateWorkItems(documents, docIdToPatientId, {}, {
              lookback: DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK,
            });
            setEstimatePredApproved(items.filter((i) => isPredApprovedDocumentStatus(i.workflowStatus)).length);
            setEstimatePredFollowUp(items.filter((i) => isPredFollowUpDocumentStatus(i.workflowStatus)).length);
          })
          .catch((err) => {
            console.error('estimate attachment fetch failed', err);
          });
      },
      (err) => {
        console.error('documents listener failed', err);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsubA = onSnapshot(
      query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000)),
      (snap) => setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)))
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
    return () => {
      unsubA();
      unsubP();
      unsubInfo();
      unsubProc();
    };
  }, []);

  // Defer badge counts so Firestore snapshots cannot block auth / first paint.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const run = () => {
        const counts = computeFrontDeskQueueCounts(appointments, patientsById, patientInfoById, new Date(), {
          procedureCodes,
        });
        if (!cancelled) {
          startTransition(() => setFrontDeskByQueue(counts));
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
  }, [appointments, patientsById, patientInfoById, procedureCodes]);

  const value = useMemo<NavBadgeState>(
    () => ({
      openInquiries,
      hiddenInquiries,
      estimatePredApproved,
      estimatePredFollowUp,
      frontDeskByQueue,
      frontDeskTotal: frontDeskQueueTotal(frontDeskByQueue),
    }),
    [openInquiries, hiddenInquiries, estimatePredApproved, estimatePredFollowUp, frontDeskByQueue]
  );

  return <NavBadgeContext.Provider value={value}>{children}</NavBadgeContext.Provider>;
};

export function useNavBadges(): NavBadgeState {
  return useContext(NavBadgeContext);
}
