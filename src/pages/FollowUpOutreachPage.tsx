import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useAuth } from '../contexts/AuthContext';
import { fetchCoverageForPlans } from '../lib/estimateProcedureCoverage';
import { fetchLedgerForPatients } from '../lib/ledgerTransactions';
import {
  buildClaimsByPatientId,
  type DentrixInsuranceClaimDoc,
} from '../lib/insuranceClaimEstimates';
import {
  ESTIMATE_CODE_TYPE_FILTER_ALL,
  ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED,
  ESTIMATE_CODE_TYPE_GROUPS,
  buildDocumentProcedureContext,
  buildInsuredByPatientGuidMap,
  formatCodeTypeLabel,
  formatProcedureCodesSummary,
  primaryCodeTypeFilterId,
  type DentrixCoverageTableDoc,
  type DentrixInsuredDoc,
  type DentrixProcedureCodeDoc,
  type DocumentProcedureContext,
} from '../lib/procedureCodeTypes';
import { buildAdaByProccodeId } from '../lib/queueProcedureCodes';
import {
  ESTIMATE_ACTION_LABELS,
  autoCloseCompletedEstimatePatch,
  filterProcedureContextByGroup,
  isSnoozed,
  isTrackedTreatmentCompleted,
  matchesEstimateAgeBucket,
  monthsSinceDate,
  parseActionHistory,
  resolveTreatmentDate,
  type EstimateAgeBucket,
  type EstimateFollowUpAction,
} from '../lib/estimateTreatment';
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import { parseDentrixDate } from '../lib/dentrix';
import { FOLLOW_UP_QUEUE_OUTREACH, isOpenOutreachItem } from '../lib/followUpQueues';
import { cn } from '../lib/utils';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import {
  buildDocIdToPatientIdMap,
  buildDocumentEstimateWorkItems,
  filterEstimateCandidateDocuments,
  DEFAULT_ESTIMATE_AGE_BUCKET,
  ESTIMATE_AGE_BUCKET_OPTIONS,
  estimateDocumentsFirestoreQuery,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  workflowStatusBadgeClass,
  workflowStatusLabel,
  type DentrixDocumentAttachmentDoc,
  type DentrixDocumentDoc,
  type DocumentEstimateWorkflowStatus,
} from '../lib/documentEstimates';
import { fetchAttachmentsForDocIds, fetchPatientsByPatientIds } from '../lib/documentAttachments';
import { appendTimestampedFollowUpNote } from '../lib/followUpNotes';
import {
  buildNextApptLabelFromPatientInfo,
  fetchClaimsForPatientIds,
  fetchFollowUpsForDocIds,
  fetchInsuredForPatientGuids,
  fetchPatientInfoByPatientIds,
} from '../lib/estimatePageData';
import {
  cleanDentrixText,
  isActiveDentrixPatient,
  type DentrixPatientAppointmentInfoDoc,
  type DentrixPatientDoc,
} from '../lib/dentrix';

export type EstimateFollowUpHubTab = 'pred_approved' | 'pred_follow_up';

export interface FollowUpOutreachPageProps {
  initialTab?: EstimateFollowUpHubTab;
}

const ESTIMATE_PAGE_SIZE = 40;

const OUTREACH_TOGGLE_ACTIONS: EstimateFollowUpAction[] = [
  'no_answer',
  'left_voicemail',
  'text',
  'email',
];

const CLOSE_TOGGLE_ACTIONS: EstimateFollowUpAction[] = ['patient_declined', 'removed_from_list'];

interface DocumentEstimateRow {
  docId: number;
  followUpDocId: string;
  patientId: string;
  patientName: string;
  descript: string;
  createdLabel: string | null;
  treatmentDateLabel: string | null;
  treatmentDateSource: 'ledger' | 'document';
  documentStatus: DocumentEstimateWorkflowStatus;
  nextApptInSystem: string;
  procedureContext: DocumentProcedureContext;
  codeTypeFilterId: string;
  outcome?: string;
  notes?: string;
  lastNoteAt?: string;
  actionFlags?: Partial<Record<EstimateFollowUpAction, boolean>>;
  actionHistory?: ReturnType<typeof parseActionHistory>;
  snoozeUntil?: string;
  bookedApptDate?: string;
}

interface UndoCloseState {
  followUpDocId: string;
  row: DocumentEstimateRow;
  previousFollowUp: Record<string, unknown> | null;
  expiresAt: number;
}

const TAB_LABELS: Record<EstimateFollowUpHubTab, string> = {
  pred_approved: 'Pre-d approved / approved (EOB)',
  pred_follow_up: 'Pre-d to follow up',
};

const FollowUpOutreachPage: React.FC<FollowUpOutreachPageProps> = ({ initialTab = 'pred_approved' }) => {
  const { user, userProfile } = useAuth();
  const [tab, setTab] = useState<EstimateFollowUpHubTab>(initialTab);
  const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
  const [documents, setDocuments] = useState<DentrixDocumentDoc[]>([]);
  const [attachments, setAttachments] = useState<DentrixDocumentAttachmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
  const [followUpByDocId, setFollowUpByDocId] = useState<Record<string, Record<string, unknown>>>({});
  const [procedureCodes, setProcedureCodes] = useState<DentrixProcedureCodeDoc[]>([]);
  const [insuredRows, setInsuredRows] = useState<DentrixInsuredDoc[]>([]);
  const [insuranceClaims, setInsuranceClaims] = useState<DentrixInsuranceClaimDoc[]>([]);
  const [ledgerByPatientId, setLedgerByPatientId] = useState<Map<number, DentrixLedgerTransactionDoc[]>>(new Map());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [coverageByPlanId, setCoverageByPlanId] = useState<Map<number, DentrixCoverageTableDoc[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [documentsLoadError, setDocumentsLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [codeTypeFilter, setCodeTypeFilter] = useState(ESTIMATE_CODE_TYPE_FILTER_ALL);
  const [ageBucket, setAgeBucket] = useState<EstimateAgeBucket>(DEFAULT_ESTIMATE_AGE_BUCKET);
  const [groupByCodeType, setGroupByCodeType] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bookedDateDraft, setBookedDateDraft] = useState<Record<string, string>>({});
  const [snoozeDraft, setSnoozeDraft] = useState<Record<string, string>>({});
  const [saveNotice, setSaveNotice] = useState<{ id: string; message: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(ESTIMATE_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(() => new Set());
  const [undoClose, setUndoClose] = useState<UndoCloseState | null>(null);
  const loadMoreSentinelRef = useRef<HTMLTableRowElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const autoClosedLedgerRef = useRef(new Set<string>());

  const authorName = userProfile?.displayName ?? user?.email ?? 'User';

  const flashSaveNotice = useCallback((id: string, message = 'Saved') => {
    setSaveNotice({ id, message });
    window.setTimeout(() => {
      setSaveNotice((prev) => (prev?.id === id ? null : prev));
    }, 2500);
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setLoading(true);
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending <= 0) setLoading(false);
    };

    const documentsQuery = estimateDocumentsFirestoreQuery(db, ageBucket);
    const unsubDocs = onSnapshot(
      documentsQuery,
      (snap) => {
        setDocuments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixDocumentDoc)));
        setDocumentsLoadError(null);
        done();
      },
      (err) => {
        console.error('documents listener failed', err);
        setDocuments([]);
        setDocumentsLoadError(err instanceof Error ? err.message : 'Could not load documents from Firestore.');
        done();
      }
    );
    const unsubProcCodes = onSnapshot(collection(db, 'procedure_codes'), (snap) => {
      setProcedureCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixProcedureCodeDoc)));
      done();
    });

    return () => {
      unsubDocs();
      unsubProcCodes();
    };
  }, [ageBucket]);

  useEffect(() => {
    const candidates = filterEstimateCandidateDocuments(documents, 'all');
    const docIds = candidates
      .map((d) => Number(d.docid ?? d.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (docIds.length === 0) {
      setAttachments([]);
      setPatientsById({});
      return;
    }

    let cancelled = false;
    void fetchAttachmentsForDocIds(db, docIds)
      .then((rows) => {
        if (!cancelled) setAttachments(rows);
      })
      .catch((err) => {
        console.error('estimate attachment fetch failed', err);
        if (!cancelled) setAttachments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [documents]);

  const docIdToPatientId = useMemo(() => buildDocIdToPatientIdMap(attachments), [attachments]);

  useEffect(() => {
    const patientIds = [...new Set(docIdToPatientId.values())];
    if (patientIds.length === 0) {
      setPatientsById({});
      return;
    }
    let cancelled = false;
    void fetchPatientsByPatientIds(db, patientIds).then((map) => {
      if (!cancelled) setPatientsById(map);
    });
    return () => {
      cancelled = true;
    };
  }, [docIdToPatientId]);

  const claimsByPatientId = useMemo(() => buildClaimsByPatientId(insuranceClaims), [insuranceClaims]);

  const insuredByGuid = useMemo(() => buildInsuredByPatientGuidMap(insuredRows), [insuredRows]);

  const adaByProccodeId = useMemo(() => buildAdaByProccodeId(procedureCodes), [procedureCodes]);

  const documentWorkItems = useMemo(
    () =>
      buildDocumentEstimateWorkItems(documents, docIdToPatientId, patientsById, {
        lookback: 'all',
      }),
    [documents, docIdToPatientId, patientsById]
  );

  useEffect(() => {
    if (!documentWorkItems.length) {
      setFollowUpByDocId({});
      setInsuranceClaims([]);
      setPatientInfoById({});
      setInsuredRows([]);
      return;
    }

    let cancelled = false;
    const patientIds = [...new Set(documentWorkItems.map((d) => d.patientId))];
    const followUpIds = documentWorkItems.map((d) => d.followUpDocId);
    const patientGuids = [
      ...new Set(
        documentWorkItems
          .map((d) => cleanDentrixText(patientsById[d.patientId]?.patient_guid))
          .filter(Boolean)
      ),
    ];

    void Promise.all([
      fetchFollowUpsForDocIds(db, followUpIds),
      fetchClaimsForPatientIds(
        db,
        patientIds.map((id) => Number(id))
      ),
      fetchPatientInfoByPatientIds(db, patientIds),
      fetchInsuredForPatientGuids(db, patientGuids),
    ])
      .then(([followUps, claims, patientInfo, insured]) => {
        if (cancelled) return;
        setFollowUpByDocId(followUps);
        setInsuranceClaims(claims);
        setPatientInfoById(patientInfo);
        setInsuredRows(insured);
      })
      .catch((err) => {
        console.error('estimate supplemental load failed', err);
      });

    return () => {
      cancelled = true;
    };
  }, [documentWorkItems, patientsById]);

  const ageBucketLabel =
    ESTIMATE_AGE_BUCKET_OPTIONS.find((o) => o.id === ageBucket)?.label ?? 'All dates';

  const nextAppointmentByPatientId = useMemo(
    () => buildNextApptLabelFromPatientInfo(patientInfoById),
    [patientInfoById]
  );

  const openDocumentItem = (item: (typeof documentWorkItems)[0]) => {
    const fu = followUpByDocId[item.followUpDocId];
    if (fu && isSnoozed(fu.snoozeUntil)) return false;
    if (!fu) return true;
    if (item.workflowStatus === 'covered_eob') return fu.documentCoveredNoted !== true;
    if (fu.autoClosedLedger === true || fu.treatmentFinished === true) {
      if (isLedgerCompletedForItem(item)) return false;
      return true;
    }
    if (fu.status === 'closed' || fu.removedFromList === true) {
      return false;
    }
    return isOpenOutreachItem(fu as Record<string, unknown>);
  };

  const isLedgerCompletedForItem = useCallback(
    (d: (typeof documentWorkItems)[0], filterGroupId?: string) => {
      const patientLedger = ledgerByPatientId.get(Number(d.patientId)) ?? [];
      const fullContext = buildDocumentProcedureContext({
        descript: d.descript,
        patientId: d.patientId,
        patientGuid: d.patientGuid,
        documentDate: d.createdate,
        ledgerRows: patientLedger,
        insuranceClaims: claimsByPatientId.get(Number(d.patientId)) ?? [],
        procedureCodes,
        insuredByGuid,
        coverageByPlanId,
      });
      const activeGroupId =
        filterGroupId ??
        (codeTypeFilter !== ESTIMATE_CODE_TYPE_FILTER_ALL
          ? codeTypeFilter
          : primaryCodeTypeFilterId(fullContext));
      const procedureContext = filterProcedureContextByGroup(fullContext, activeGroupId);
      return isTrackedTreatmentCompleted(
        procedureContext,
        activeGroupId,
        patientLedger,
        adaByProccodeId,
        parseDentrixDate(d.createdate)
      );
    },
    [
      ledgerByPatientId,
      claimsByPatientId,
      procedureCodes,
      insuredByGuid,
      coverageByPlanId,
      codeTypeFilter,
      adaByProccodeId,
    ]
  );

  const mapDocumentRow = (d: (typeof documentWorkItems)[0]): DocumentEstimateRow | null => {
    const fu = followUpByDocId[d.followUpDocId];
    const patientLedger = ledgerByPatientId.get(Number(d.patientId)) ?? [];
    const fullContext = buildDocumentProcedureContext({
      descript: d.descript,
      patientId: d.patientId,
      patientGuid: d.patientGuid,
      documentDate: d.createdate,
      ledgerRows: patientLedger,
      insuranceClaims: claimsByPatientId.get(Number(d.patientId)) ?? [],
      procedureCodes,
      insuredByGuid,
      coverageByPlanId,
    });

    const activeGroupId =
      codeTypeFilter !== ESTIMATE_CODE_TYPE_FILTER_ALL
        ? codeTypeFilter
        : primaryCodeTypeFilterId(fullContext);
    const procedureContext = filterProcedureContextByGroup(fullContext, activeGroupId);

    const treatment = resolveTreatmentDate(
      procedureContext,
      d.createdate,
      activeGroupId,
      patientLedger,
      adaByProccodeId
    );

    const ledgerLoaded = ledgerByPatientId.has(Number(d.patientId));
    if (ledgerLoaded && isLedgerCompletedForItem(d, activeGroupId)) {
      return null;
    }

    const months = monthsSinceDate(treatment.date);
    if (!matchesEstimateAgeBucket(months, ageBucket)) return null;

    return {
      docId: d.docId,
      followUpDocId: d.followUpDocId,
      patientId: d.patientId,
      patientName: d.patientName,
      descript: d.descript,
      createdLabel: d.createdLabel,
      treatmentDateLabel: treatment.label,
      treatmentDateSource: treatment.source,
      documentStatus: d.workflowStatus,
      nextApptInSystem: nextAppointmentByPatientId[d.patientId] ?? '—',
      procedureContext,
      codeTypeFilterId: primaryCodeTypeFilterId(procedureContext),
      outcome: fu ? String(fu.outcome ?? '') : undefined,
      notes: fu ? String(fu.notes ?? '') : undefined,
      lastNoteAt: fu ? String(fu.lastNoteAt ?? '') : undefined,
      actionFlags: (fu?.actionFlags as DocumentEstimateRow['actionFlags']) ?? {},
      actionHistory: parseActionHistory(fu?.actionHistory ?? fu?.outreachHistory),
      snoozeUntil: fu ? String(fu.snoozeUntil ?? '') : undefined,
      bookedApptDate: fu ? String(fu.bookedApptDate ?? '') : undefined,
    };
  };

  const predApprovedRows = useMemo<DocumentEstimateRow[]>(() => {
    return documentWorkItems
      .filter((d) => isPredApprovedDocumentStatus(d.workflowStatus))
      .filter(openDocumentItem)
      .filter((d) => {
        const p = patientsById[d.patientId];
        return !p || isActiveDentrixPatient(p);
      })
      .map(mapDocumentRow)
      .filter((r): r is DocumentEstimateRow => !!r);
  }, [
    documentWorkItems,
    followUpByDocId,
    patientsById,
    nextAppointmentByPatientId,
    procedureCodes,
    ledgerByPatientId,
    claimsByPatientId,
    insuredByGuid,
    coverageByPlanId,
    codeTypeFilter,
    ageBucket,
    adaByProccodeId,
  ]);

  const predFollowUpRows = useMemo<DocumentEstimateRow[]>(() => {
    return documentWorkItems
      .filter((d) => isPredFollowUpDocumentStatus(d.workflowStatus))
      .filter(openDocumentItem)
      .filter((d) => {
        const p = patientsById[d.patientId];
        return !p || isActiveDentrixPatient(p);
      })
      .map(mapDocumentRow)
      .filter((r): r is DocumentEstimateRow => !!r);
  }, [
    documentWorkItems,
    followUpByDocId,
    patientsById,
    nextAppointmentByPatientId,
    procedureCodes,
    ledgerByPatientId,
    claimsByPatientId,
    insuredByGuid,
    coverageByPlanId,
    codeTypeFilter,
    ageBucket,
    adaByProccodeId,
  ]);

  const matchesSearch = useCallback((row: DocumentEstimateRow) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const codeSummary = formatProcedureCodesSummary(row.procedureContext.procedureCodes).toLowerCase();
    const typeLabels = row.procedureContext.codeTypes.map((t) => t.label).join(' ').toLowerCase();
    return (
      row.patientName.toLowerCase().includes(q) ||
      row.descript.toLowerCase().includes(q) ||
      row.patientId.toLowerCase().includes(q) ||
      row.nextApptInSystem.toLowerCase().includes(q) ||
      codeSummary.includes(q) ||
      typeLabels.includes(q)
    );
  }, [search]);

  const matchesCodeTypeFilter = useCallback((row: DocumentEstimateRow) => {
    if (codeTypeFilter === ESTIMATE_CODE_TYPE_FILTER_ALL) return true;
    if (codeTypeFilter === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) {
      return row.codeTypeFilterId === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED;
    }
    return row.procedureContext.codeTypes.some((t) => t.groupId === codeTypeFilter);
  }, [codeTypeFilter]);

  const filteredApproved = useMemo(
    () =>
      predApprovedRows
        .filter(matchesSearch)
        .filter(matchesCodeTypeFilter)
        .filter((r) => !pendingRemovalIds.has(r.followUpDocId)),
    [predApprovedRows, matchesSearch, matchesCodeTypeFilter, pendingRemovalIds]
  );

  const filteredFollowUp = useMemo(
    () =>
      predFollowUpRows
        .filter(matchesSearch)
        .filter(matchesCodeTypeFilter)
        .filter((r) => !pendingRemovalIds.has(r.followUpDocId)),
    [predFollowUpRows, matchesSearch, matchesCodeTypeFilter, pendingRemovalIds]
  );

  const displayedTabRows = tab === 'pred_approved' ? filteredApproved : filteredFollowUp;

  useEffect(() => {
    setVisibleCount(ESTIMATE_PAGE_SIZE);
  }, [tab, search, codeTypeFilter, ageBucket, groupByCodeType]);

  const visibleRows = useMemo(
    () => displayedTabRows.slice(0, visibleCount),
    [displayedTabRows, visibleCount]
  );

  const hasMoreRows = visibleCount < displayedTabRows.length;

  useEffect(() => {
    if (!visibleRows.length) return;

    for (const row of visibleRows) {
      const d = documentWorkItems.find((w) => w.followUpDocId === row.followUpDocId);
      if (!d) continue;
      if (!ledgerByPatientId.has(Number(d.patientId))) continue;
      const fu = followUpByDocId[d.followUpDocId];
      if (fu?.treatmentFinished === true || fu?.autoClosedLedger === true) continue;
      if (autoClosedLedgerRef.current.has(d.followUpDocId)) continue;
      if (!isLedgerCompletedForItem(d)) continue;

      autoClosedLedgerRef.current.add(d.followUpDocId);
      void setDoc(
        doc(db, 'followUps', d.followUpDocId),
        {
          source: 'document_center',
          queue: FOLLOW_UP_QUEUE_OUTREACH,
          patient_id: Number(d.patientId),
          patient_name: d.patientName,
          dentrix_doc_id: d.docId,
          document_descript: d.descript,
          ...autoCloseCompletedEstimatePatch(authorName),
        },
        { merge: true }
      );
    }
  }, [visibleRows, documentWorkItems, followUpByDocId, isLedgerCompletedForItem, authorName, ledgerByPatientId]);

  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || !hasMoreRows) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setLoadingMore(true);
        window.setTimeout(() => {
          setVisibleCount((n) => n + ESTIMATE_PAGE_SIZE);
          setLoadingMore(false);
        }, 120);
      },
      { rootMargin: '240px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreRows, visibleCount, displayedTabRows.length]);

  const ledgerPatientIds = useMemo(
    () => [...new Set(visibleRows.map((r) => r.patientId))],
    [visibleRows]
  );

  useEffect(() => {
    const missing = ledgerPatientIds.filter((id) => !ledgerByPatientId.has(Number(id)));
    if (!missing.length) return;

    let cancelled = false;
    setLedgerLoading(true);
    fetchLedgerForPatients(missing)
      .then((map) => {
        if (cancelled) return;
        setLedgerByPatientId((prev) => {
          const next = new Map(prev);
          map.forEach((rows, patid) => next.set(patid, rows));
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ledgerPatientIds, ledgerByPatientId]);

  useEffect(() => {
    const planIds = [
      ...new Set(
        visibleRows
          .map((r) => r.procedureContext.insurancePlanId)
          .filter((id): id is number => typeof id === 'number' && id > 0)
          .filter((id) => !coverageByPlanId.has(id))
      ),
    ];
    if (!planIds.length) return;

    let cancelled = false;
    fetchCoverageForPlans(planIds).then((map) => {
      if (!cancelled) setCoverageByPlanId((prev) => new Map([...prev, ...map]));
    });
    return () => {
      cancelled = true;
    };
  }, [visibleRows, coverageByPlanId]);

  const upsertDocumentFollowUp = async (row: DocumentEstimateRow, patch: Record<string, unknown>) => {
    await setDoc(
      doc(db, 'followUps', row.followUpDocId),
      {
        source: 'document_center',
        queue: FOLLOW_UP_QUEUE_OUTREACH,
        patient_id: Number(row.patientId),
        patient_name: row.patientName,
        dentrix_doc_id: row.docId,
        document_descript: row.descript,
        document_workflow: row.documentStatus,
        lastChanged: new Date().toISOString(),
        contactedBy: authorName,
        category: row.procedureContext.primaryCodeType?.label ?? row.descript,
        procedure_codes: row.procedureContext.procedureCodes.map((c) => c.code),
        code_type: row.procedureContext.primaryCodeType?.label ?? null,
        ...patch,
      },
      { merge: true }
    );
  };

  const handleMarkCovered = async (row: DocumentEstimateRow) => {
    setUpdatingId(row.followUpDocId);
    try {
      await upsertDocumentFollowUp(row, {
        status: 'covered_eob',
        outcome: 'Approved — explanation of benefits on file',
        documentCoveredNoted: true,
        nextAppointmentBooked: true,
      });
      flashSaveNotice(row.followUpDocId, 'Marked noted');
    } finally {
      setUpdatingId(null);
    }
  };

  const applyFollowUpPatch = useCallback(
    (followUpDocId: string, patch: Record<string, unknown>) => {
      setFollowUpByDocId((prev) => ({
        ...prev,
        [followUpDocId]: { ...(prev[followUpDocId] ?? {}), ...patch },
      }));
    },
    []
  );

  const buildActionPatch = (
    row: DocumentEstimateRow,
    action: EstimateFollowUpAction,
    enabled: boolean,
    extra?: { bookedApptDate?: string; snoozeUntil?: string }
  ) => {
    const prev = followUpByDocId[row.followUpDocId];
    const prevFlags = (prev?.actionFlags as Record<string, boolean>) ?? row.actionFlags ?? {};
    const prevHistory = parseActionHistory(prev?.actionHistory ?? prev?.outreachHistory);

    const actionFlags = { ...prevFlags, [action]: enabled };
    const historyEntry = {
      action,
      at: new Date().toISOString(),
      by: authorName,
      detail: extra?.bookedApptDate ? `Appt ${extra.bookedApptDate}` : undefined,
    };
    const actionHistory = enabled ? [...prevHistory, historyEntry].slice(-25) : prevHistory;

    const noteLine = `${ESTIMATE_ACTION_LABELS[action]}${enabled ? '' : ' (cleared)'}`;
    const notePatch = appendTimestampedFollowUpNote(row.notes, noteLine, authorName);

    const closesList =
      enabled &&
      (action === 'removed_from_list' || action === 'treatment_finished' || action === 'patient_declined');

    return {
      status: closesList ? 'closed' : 'estimate_followup',
      outcome: ESTIMATE_ACTION_LABELS[action],
      actionFlags,
      actionHistory,
      ...notePatch,
      nextAppointmentBooked:
        closesList || (enabled && action === 'treatment_booked') ? true : prev?.nextAppointmentBooked === true,
      treatmentFinished: enabled && action === 'treatment_finished' ? true : prev?.treatmentFinished === true,
      removedFromList:
        enabled && (action === 'removed_from_list' || action === 'patient_declined')
          ? true
          : prev?.removedFromList === true,
      bookedApptDate: extra?.bookedApptDate ?? prev?.bookedApptDate ?? null,
      snoozeUntil: extra?.snoozeUntil ?? prev?.snoozeUntil ?? null,
    };
  };

  const handleEstimateAction = async (
    row: DocumentEstimateRow,
    action: EstimateFollowUpAction,
    enabled: boolean,
    extra?: { bookedApptDate?: string; snoozeUntil?: string }
  ) => {
    setSavingId(row.followUpDocId);
    const patch = buildActionPatch(row, action, enabled, extra);
    applyFollowUpPatch(row.followUpDocId, patch);
    try {
      await upsertDocumentFollowUp(row, patch);
      flashSaveNotice(row.followUpDocId);
    } catch (err) {
      console.error('follow-up save failed', err);
      void fetchFollowUpsForDocIds(db, [row.followUpDocId]).then((map) => {
        if (map[row.followUpDocId]) applyFollowUpPatch(row.followUpDocId, map[row.followUpDocId]);
      });
    } finally {
      setSavingId(null);
    }
  };

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const handleUndoTreatmentComplete = useCallback(async () => {
    if (!undoClose) return;
    clearUndoTimer();
    const { followUpDocId, previousFollowUp } = undoClose;
    setPendingRemovalIds((prev) => {
      const next = new Set(prev);
      next.delete(followUpDocId);
      return next;
    });
    setUndoClose(null);

    if (previousFollowUp) {
      applyFollowUpPatch(followUpDocId, previousFollowUp);
      await setDoc(doc(db, 'followUps', followUpDocId), previousFollowUp, { merge: true });
    } else {
      setFollowUpByDocId((prev) => {
        const next = { ...prev };
        delete next[followUpDocId];
        return next;
      });
      await setDoc(
        doc(db, 'followUps', followUpDocId),
        {
          treatmentFinished: false,
          autoClosedLedger: false,
          removedFromList: false,
          status: 'estimate_followup',
          nextAppointmentBooked: false,
        },
        { merge: true }
      );
    }
    flashSaveNotice(followUpDocId, 'Undone');
  }, [undoClose, clearUndoTimer, applyFollowUpPatch, flashSaveNotice]);

  const handleTreatmentComplete = async (row: DocumentEstimateRow) => {
    const confirmed = window.confirm(
      `Mark treatment complete for ${row.patientName} and remove from this list?`
    );
    if (!confirmed) return;

    clearUndoTimer();
    const previousFollowUp = followUpByDocId[row.followUpDocId]
      ? { ...followUpByDocId[row.followUpDocId] }
      : null;

    setPendingRemovalIds((prev) => new Set(prev).add(row.followUpDocId));
    setUndoClose({
      followUpDocId: row.followUpDocId,
      row,
      previousFollowUp,
      expiresAt: Date.now() + 5000,
    });

    const patch = buildActionPatch(row, 'treatment_finished', true);
    applyFollowUpPatch(row.followUpDocId, patch);
    setSavingId(row.followUpDocId);
    try {
      await upsertDocumentFollowUp(row, patch);
    } catch (err) {
      console.error('treatment complete save failed', err);
      setPendingRemovalIds((prev) => {
        const next = new Set(prev);
        next.delete(row.followUpDocId);
        return next;
      });
      setUndoClose(null);
    } finally {
      setSavingId(null);
    }

    undoTimerRef.current = window.setTimeout(() => {
      setUndoClose((current) => (current?.followUpDocId === row.followUpDocId ? null : current));
      undoTimerRef.current = null;
    }, 5000);
  };

  useEffect(() => () => clearUndoTimer(), [clearUndoTimer]);

  const handleSnooze = async (row: DocumentEstimateRow) => {
    const draft = snoozeDraft[row.followUpDocId] ?? '';
    if (!draft) return;
    setSavingId(row.followUpDocId);
    try {
      await upsertDocumentFollowUp(row, {
        snoozeUntil: `${draft}T12:00:00.000Z`,
        status: 'estimate_followup',
      });
      setSnoozeDraft((prev) => {
        const next = { ...prev };
        delete next[row.followUpDocId];
        return next;
      });
      flashSaveNotice(row.followUpDocId, 'Snoozed');
    } finally {
      setSavingId(null);
    }
  };

  const groupRowsByCodeType = (rows: DocumentEstimateRow[]) => {
    const order = new Map(ESTIMATE_CODE_TYPE_GROUPS.map((g, i) => [g.id, i]));
    const buckets = new Map<string, DocumentEstimateRow[]>();

    for (const row of rows) {
      const key = row.codeTypeFilterId;
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }

    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) return 1;
      if (b === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) return -1;
      const ai = order.get(a) ?? 999;
      const bi = order.get(b) ?? 999;
      if (ai !== bi) return ai - bi;
      const la = buckets.get(a)?.[0]?.procedureContext.primaryCodeType?.label ?? a;
      const lb = buckets.get(b)?.[0]?.procedureContext.primaryCodeType?.label ?? b;
      return la.localeCompare(lb);
    });

    return keys.map((key) => {
      const groupRows = buckets.get(key) ?? [];
      const label =
        key === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED
          ? 'Uncategorized'
          : groupRows[0]?.procedureContext.primaryCodeType?.label ??
            ESTIMATE_CODE_TYPE_GROUPS.find((g) => g.id === key)?.label ??
            key;
      return { key, label, rows: groupRows };
    });
  };

  const renderStatusBadge = (status: DocumentEstimateWorkflowStatus) => (
    <span
      className={`inline-flex mt-1 px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide ${workflowStatusBadgeClass(status)}`}
    >
      {workflowStatusLabel(status)}
    </span>
  );

  const linkSourceHint = (ctx: DocumentProcedureContext): string | null => {
    switch (ctx.linkSource) {
      case 'insurance_claim':
        return 'Linked via insurance claim (pre-determination)';
      case 'ledger_preauth':
        return ctx.preauthId ? `Linked via pre-auth #${ctx.preauthId} (ledger)` : 'Linked via ledger pre-auth';
      case 'ledger_claim':
        return ctx.claimId ? `Linked via claim #${ctx.claimId} (ledger)` : 'Linked via ledger claim';
      case 'ledger_date':
        return 'Linked via ledger (date / code match)';
      case 'ledger_treatment_planned':
        return 'Linked via treatment-planned procedures (ledger)';
      case 'document_text':
        return 'Codes parsed from document text';
      default:
        return null;
    }
  };

  const renderProcedureContext = (ctx: DocumentProcedureContext) => {
    const codesSummary = formatProcedureCodesSummary(ctx.procedureCodes);
    const hint = linkSourceHint(ctx);
    if (!ctx.primaryCodeType && !codesSummary) {
      return (
        <div className="space-y-1">
          <span className="text-slate-400">—</span>
          {ledgerLoading && <p className="text-[9px] text-slate-400">Loading ledger…</p>}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {ctx.primaryCodeType && (
          <p className="text-xs font-bold text-slate-800">{formatCodeTypeLabel(ctx.primaryCodeType)}</p>
        )}
        {codesSummary && (
          <p className="text-[10px] text-slate-500 leading-snug" title={codesSummary}>
            {codesSummary}
          </p>
        )}
        {hint && (
          <p className="text-[9px] text-slate-400 font-medium" title={hint}>
            {hint}
          </p>
        )}
      </div>
    );
  };

  const renderActionHistory = (row: DocumentEstimateRow) => {
    const items = row.actionHistory ?? [];
    if (!items.length) return <span className="text-slate-400">—</span>;
    return (
      <ul className="space-y-0.5">
        {items
          .slice(-3)
          .reverse()
          .map((entry, i) => (
            <li key={`${entry.at}-${i}`} className="text-[10px] text-slate-600 leading-snug">
              {ESTIMATE_ACTION_LABELS[entry.action] ?? entry.action}
              {' — '}
              <span className="text-slate-400 tabular-nums">
                {entry.at.slice(0, 10)}
              </span>
            </li>
          ))}
      </ul>
    );
  };

  const renderDataRow = (r: DocumentEstimateRow, options: { showCovered?: boolean } = {}) => {
    const { showCovered = false } = options;
    const busy = savingId === r.followUpDocId || updatingId === r.followUpDocId;
    return (
      <tr key={r.followUpDocId} className="hover:bg-slate-50/80 align-top">
        <td className="p-3 pl-4">
          <PatientProfileTrigger patientId={r.patientId} className="normal-case font-bold text-left">
            <p className="font-bold text-slate-900">{r.patientName}</p>
            <p className="text-[10px] text-slate-400 font-normal pointer-events-none">ID {r.patientId}</p>
          </PatientProfileTrigger>
        </td>
        <td className="p-3 max-w-[200px]">{renderProcedureContext(r.procedureContext)}</td>
        <td className="p-3">
          <p className="text-xs font-semibold text-slate-800">{r.descript}</p>
          {renderStatusBadge(r.documentStatus)}
        </td>
        <td className="p-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
          {r.treatmentDateLabel ?? r.createdLabel ?? '—'}
          {r.treatmentDateSource === 'ledger' && (
            <p className="text-[9px] text-teal-700 font-bold mt-0.5">From ledger</p>
          )}
        </td>
        <td className="p-3 text-xs text-slate-700 max-w-[200px]">
          <p className="font-bold tabular-nums leading-snug">{r.nextApptInSystem}</p>
        </td>
        <td className="p-3 text-xs text-slate-500 max-w-[220px]">{renderActionHistory(r)}</td>
        <td className="p-3 min-w-[320px]">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {OUTREACH_TOGGLE_ACTIONS.map((action) => {
                const checked = !!r.actionFlags?.[action];
                return (
                  <label
                    key={action}
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-700 cursor-pointer whitespace-nowrap',
                      busy && 'opacity-50 pointer-events-none'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={checked}
                      disabled={busy}
                      onChange={(e) => void handleEstimateAction(r, action, e.target.checked)}
                    />
                    <span>{ESTIMATE_ACTION_LABELS[action]}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  'inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-700 cursor-pointer',
                  busy && 'opacity-50 pointer-events-none'
                )}
              >
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={!!r.actionFlags?.treatment_booked}
                  disabled={busy}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (!on) {
                      void handleEstimateAction(r, 'treatment_booked', false);
                      return;
                    }
                    const draft = bookedDateDraft[r.followUpDocId] ?? r.bookedApptDate?.slice(0, 10) ?? '';
                    if (!draft) return;
                    void handleEstimateAction(r, 'treatment_booked', true, { bookedApptDate: draft });
                  }}
                />
                <span>{ESTIMATE_ACTION_LABELS.treatment_booked}</span>
              </label>
              <Input
                type="date"
                className="h-7 text-[10px] w-[124px]"
                disabled={busy}
                value={bookedDateDraft[r.followUpDocId] ?? r.bookedApptDate?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setBookedDateDraft((prev) => ({ ...prev, [r.followUpDocId]: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {CLOSE_TOGGLE_ACTIONS.map((action) => (
                <label
                  key={action}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer whitespace-nowrap',
                    busy && 'opacity-50 pointer-events-none'
                  )}
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={!!r.actionFlags?.[action]}
                    disabled={busy}
                    onChange={(e) => void handleEstimateAction(r, action, e.target.checked)}
                  />
                  <span>{ESTIMATE_ACTION_LABELS[action]}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[9px] font-black uppercase border-slate-300"
                disabled={busy}
                onClick={() => void handleTreatmentComplete(r)}
              >
                Treatment complete
              </Button>
              <Input
                type="date"
                className="h-7 text-[10px] w-[124px]"
                disabled={busy}
                value={snoozeDraft[r.followUpDocId] ?? r.snoozeUntil?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setSnoozeDraft((prev) => ({ ...prev, [r.followUpDocId]: e.target.value }))
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[9px] font-black uppercase"
                disabled={busy}
                onClick={() => void handleSnooze(r)}
              >
                Snooze
              </Button>
            </div>
            {saveNotice?.id === r.followUpDocId && (
              <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wide">{saveNotice.message}</p>
            )}
          </div>
        </td>
        <td className="p-3 pr-4 text-right whitespace-nowrap">
          {showCovered && r.documentStatus === 'covered_eob' && (
            <Button
              size="sm"
              variant="outline"
              className="text-[9px] font-black uppercase border-emerald-300 text-emerald-800"
              disabled={!!updatingId}
              onClick={() => void handleMarkCovered(r)}
            >
              Mark noted
            </Button>
          )}
        </td>
      </tr>
    );
  };

  const renderTable = (
    rows: DocumentEstimateRow[],
    totalCount: number,
    emptyLabel: string,
    options: { showCovered?: boolean; hasMore?: boolean } = {}
  ) => {
    const { showCovered = false, hasMore = false } = options;
    const colSpan = 8;
    const loadMoreRow = hasMore ? (
      <tr ref={loadMoreSentinelRef}>
        <td colSpan={colSpan} className="p-4 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wide">
          {loadingMore ? 'Loading more…' : `Showing ${rows.length} of ${totalCount} — scroll for more`}
        </td>
      </tr>
    ) : rows.length > 0 && totalCount > rows.length ? (
      <tr>
        <td colSpan={colSpan} className="p-3 text-center text-[10px] font-bold text-slate-400 uppercase">
          Showing all {totalCount}
        </td>
      </tr>
    ) : null;
    const tableHead = (
      <thead>
        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
          <th className="p-3 pl-4">
            Patient
            <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
              Tap for contact card
            </span>
          </th>
          <th className="p-3">Code type</th>
          <th className="p-3">Insurance response</th>
          <th className="p-3">Treatment / estimate date</th>
          <th className="p-3">Next appt in system</th>
          <th className="p-3">Follow-up history</th>
          <th className="p-3">Treatment complete</th>
          <th className="p-3 pr-4 text-right">EOB</th>
        </tr>
      </thead>
    );

    if (rows.length === 0) {
      return (
        <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1180px]">
            {tableHead}
            <tbody>
              <tr>
                <td colSpan={colSpan} className="p-12 text-center text-xs text-slate-400 font-bold uppercase">
                  {emptyLabel}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    }

    if (groupByCodeType) {
      const sections = groupRowsByCodeType(rows);
      return (
        <div className="space-y-6">
          {sections.map((section, sectionIdx) => (
            <div key={section.key} className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-700">{section.label}</h3>
                <span className="text-[10px] font-bold text-slate-500">{section.rows.length}</span>
              </div>
              <table className="w-full text-left text-sm min-w-[1180px]">
                {tableHead}
                <tbody className="divide-y divide-slate-100">
                  {section.rows.map((r) => renderDataRow(r, { showCovered }))}
                  {sectionIdx === sections.length - 1 ? loadMoreRow : null}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1180px]">
          {tableHead}
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => renderDataRow(r, { showCovered }))}
            {loadMoreRow}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-full mx-auto bg-white font-sans pb-20">
      <div className="border-b border-slate-100 pb-6">
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase">Estimate follow-up</h1>
        <p className="text-[11px] font-bold text-slate-500 mt-2 max-w-3xl">
          Document Center pre-determinations linked to patients. Procedure codes come from{' '}
          <span className="text-slate-700">insurance_claims</span> (pre-determinations) when synced, otherwise from{' '}
          <span className="text-slate-700">ledger_transactions</span> via pre-auth / claim id and treatment-planned
          procedures. Document filenames still contribute parsed codes. Plan coverage loads from{' '}
          <span className="text-slate-700">coverage_tables</span> per patient insurance.{' '}
          <span className="text-slate-700">Explanation</span> and{' '}
          <span className="text-slate-700">explanation of benefits</span> appear under pre-d approved;{' '}
          <span className="text-slate-700">acknowledgment</span> documents appear under pre-d to follow up.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-4">
        {(['pred_approved', 'pred_follow_up'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
              tab === id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {TAB_LABELS[id]}
            <span
              className={`ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                (id === 'pred_approved' ? filteredApproved.length : filteredFollowUp.length) > 0
                  ? id === 'pred_approved'
                    ? 'bg-teal-500 text-white'
                    : 'bg-amber-500 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {id === 'pred_approved' ? filteredApproved.length : filteredFollowUp.length}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <Input
          placeholder="Search patient, code type, procedure codes, document…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md h-10 text-xs font-bold border-slate-200"
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Treatment age</p>
            <Select
              value={ageBucket}
              onChange={(e) => setAgeBucket(e.target.value as EstimateAgeBucket)}
              className="h-10 w-[168px] text-xs font-bold"
            >
              {ESTIMATE_AGE_BUCKET_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Code type</p>
            <Select
              value={codeTypeFilter}
              onChange={(e) => setCodeTypeFilter(e.target.value)}
              className="h-10 w-[200px] text-xs font-bold"
            >
              <option value={ESTIMATE_CODE_TYPE_FILTER_ALL}>All types</option>
              {ESTIMATE_CODE_TYPE_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
              <option value={ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED}>Uncategorized</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 bg-white cursor-pointer">
            <input
              type="checkbox"
              checked={groupByCodeType}
              onChange={(e) => setGroupByCodeType(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-[10px] font-black uppercase text-slate-600">Group by code type</span>
          </label>
        </div>
      </div>

      <p className="text-[10px] font-bold text-slate-500 -mt-4">
        {ageBucketLabel}
        {' · '}
        <span className="text-slate-400">
          {documents.length.toLocaleString()} document{documents.length === 1 ? '' : 's'} loaded (exclusive age buckets)
        </span>
        {' · '}
        <span className="text-slate-400">
          {predApprovedRows.length} open on pre-d approved tab · {predFollowUpRows.length} open on acknowledgment tab
        </span>
      </p>

      {documentsLoadError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not load documents: {documentsLoadError}. If this mentions an index, create it in the Firebase console
          or run <code className="text-xs">firebase deploy --only firestore:indexes</code>.
        </div>
      ) : null}

      {loading ? (
        <div className="p-24 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Loading…</div>
      ) : tab === 'pred_approved' ? (
        renderTable(visibleRows, filteredApproved.length, 'No pre-d approved or EOB documents', {
          showCovered: true,
          hasMore: hasMoreRows,
        })
      ) : (
        renderTable(visibleRows, filteredFollowUp.length, 'No pre-d acknowledgment documents to follow up', {
          hasMore: hasMoreRows,
        })
      )}

      {undoClose ? (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg">
          <p className="text-xs font-semibold text-slate-800">
            Removed {undoClose.row.patientName} — treatment marked complete
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-[10px] font-black uppercase"
            onClick={() => void handleUndoTreatmentComplete()}
          >
            Undo
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default FollowUpOutreachPage;
