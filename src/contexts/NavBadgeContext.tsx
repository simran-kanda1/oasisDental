import React, { createContext, startTransition, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
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
import { useFrontDeskData } from './FrontDeskDataContext';

const BADGE_RECOMPUTE_DEBOUNCE_MS = 300;

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
  const {
    allAppointments,
    patientsById,
    patientInfoById,
    procedureCodes,
    trackingByApptId,
    ledgerByPatientId,
  } = useFrontDeskData();

  const [openInquiries, setOpenInquiries] = useState(0);
  const [hiddenInquiries, setHiddenInquiries] = useState(0);
  const [estimatePredApproved, setEstimatePredApproved] = useState(0);
  const [estimatePredFollowUp, setEstimatePredFollowUp] = useState(0);
  const [estimatesReady, setEstimatesReady] = useState(false);
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
    if (!badgesReady) return;

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

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(loadEstimateBadges, { timeout: 6000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
      };
    }

    const timer = window.setTimeout(loadEstimateBadges, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [badgesReady]);

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
    }, BADGE_RECOMPUTE_DEBOUNCE_MS);

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
