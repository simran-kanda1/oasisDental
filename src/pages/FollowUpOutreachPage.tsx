import React, { useMemo, useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, setDoc, orderBy, limit, where } from 'firebase/firestore';
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
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import {
  logActivity,
  ACTIVITY_SECTION_FOLLOW_UP_OUTREACH,
  buildOutreachActivityDetail,
} from '../lib/activityLogger';
import { logAudit } from '../lib/auditTrail';
import { FOLLOW_UP_QUEUE_OUTREACH, isOpenOutreachItem } from '../lib/followUpQueues';
import { LogOutreachModal, type OutreachLogPayload } from '../components/LogOutreachModal';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import {
  buildDocIdToPatientIdMap,
  buildDocumentEstimateWorkItems,
  DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK,
  ESTIMATE_DOCUMENT_LOOKBACK_OPTIONS,
  estimateDocumentSince,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  workflowStatusBadgeClass,
  workflowStatusLabel,
  type DentrixDocumentAttachmentDoc,
  type DentrixDocumentDoc,
  type DocumentEstimateWorkflowStatus,
  type EstimateDocumentLookback,
} from '../lib/documentEstimates';
import { appendTimestampedFollowUpNote, latestNotePreview } from '../lib/followUpNotes';
import { buildNextAppointmentLabelByPatientId } from '../lib/appointmentHeuristics';
import {
  isActiveDentrixPatient,
  type DentrixAppointmentDoc,
  type DentrixPatientAppointmentInfoDoc,
  type DentrixPatientDoc,
} from '../lib/dentrix';

export type EstimateFollowUpHubTab = 'pred_approved' | 'pred_follow_up';

export interface FollowUpOutreachPageProps {
  initialTab?: EstimateFollowUpHubTab;
}

interface DocumentEstimateRow {
  docId: number;
  followUpDocId: string;
  patientId: string;
  patientName: string;
  descript: string;
  createdLabel: string | null;
  documentStatus: DocumentEstimateWorkflowStatus;
  nextApptInSystem: string;
  procedureContext: DocumentProcedureContext;
  codeTypeFilterId: string;
  outcome?: string;
  notes?: string;
  lastNoteAt?: string;
}

const TAB_LABELS: Record<EstimateFollowUpHubTab, string> = {
  pred_approved: 'Pre-d approved / approved (EOB)',
  pred_follow_up: 'Pre-d to follow up',
};

const FollowUpOutreachPage: React.FC<FollowUpOutreachPageProps> = ({ initialTab = 'pred_approved' }) => {
  const { user, userProfile } = useAuth();
  const [tab, setTab] = useState<EstimateFollowUpHubTab>(initialTab);
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
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
  const [search, setSearch] = useState('');
  const [codeTypeFilter, setCodeTypeFilter] = useState(ESTIMATE_CODE_TYPE_FILTER_ALL);
  const [documentLookback, setDocumentLookback] = useState<EstimateDocumentLookback>(
    DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK
  );
  const [groupByCodeType, setGroupByCodeType] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [logRow, setLogRow] = useState<DocumentEstimateRow | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const authorName = userProfile?.displayName ?? user?.email ?? 'User';

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setLoading(true);
    let pending = 8;
    let claimsPending = true;
    const done = () => {
      pending -= 1;
      if (pending <= 0) setLoading(false);
    };

    const since = estimateDocumentSince(documentLookback);
    const documentsQuery = since
      ? query(
          collection(db, 'documents'),
          where('createdate', '>=', since.toISOString()),
          orderBy('createdate', 'desc')
        )
      : query(collection(db, 'documents'), orderBy('createdate', 'desc'));

    const q = query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000));
    const unsubA = onSnapshot(q, (snap) => {
      setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
      done();
    });
    const unsubP = onSnapshot(collection(db, 'patients'), (snap) => {
      const map: Record<string, DentrixPatientDoc> = {};
      snap.docs.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
        map[String(row.patient_id ?? row.id)] = row;
      });
      setPatientsById(map);
      done();
    });
    const unsubInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
      const map: Record<string, DentrixPatientAppointmentInfoDoc> = {};
      snap.docs.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc;
        map[String(row.patient_id ?? row.id)] = row;
      });
      setPatientInfoById(map);
      done();
    });
    const unsubFu = onSnapshot(collection(db, 'followUps'), (snap) => {
      const map: Record<string, Record<string, unknown>> = {};
      snap.docs.forEach((d) => {
        map[d.id] = d.data() as Record<string, unknown>;
      });
      setFollowUpByDocId(map);
      done();
    });
    const unsubDocs = onSnapshot(
      documentsQuery,
      (snap) => {
        setDocuments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixDocumentDoc)));
        done();
      },
      () => {
        setDocuments([]);
        done();
      }
    );
    const unsubAttach = onSnapshot(collection(db, 'document_attachments'), (snap) => {
      setAttachments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixDocumentAttachmentDoc)));
      done();
    });
    const unsubProcCodes = onSnapshot(collection(db, 'procedure_codes'), (snap) => {
      setProcedureCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixProcedureCodeDoc)));
      done();
    });
    const unsubInsured = onSnapshot(collection(db, 'insured'), (snap) => {
      setInsuredRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixInsuredDoc)));
      done();
    });
    const finishClaims = () => {
      if (claimsPending) {
        claimsPending = false;
        done();
      }
    };
    const unsubClaims = onSnapshot(
      collection(db, 'insurance_claims'),
      (snap) => {
        setInsuranceClaims(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixInsuranceClaimDoc)));
        finishClaims();
      },
      () => {
        setInsuranceClaims([]);
        finishClaims();
      }
    );

    return () => {
      unsubA();
      unsubP();
      unsubInfo();
      unsubFu();
      unsubDocs();
      unsubAttach();
      unsubProcCodes();
      unsubInsured();
      unsubClaims();
    };
  }, [documentLookback]);

  const claimsByPatientId = useMemo(() => buildClaimsByPatientId(insuranceClaims), [insuranceClaims]);

  const insuredByGuid = useMemo(() => buildInsuredByPatientGuidMap(insuredRows), [insuredRows]);

  const estimateDocIds = useMemo(
    () => new Set(documents.map((d) => Number(d.docid)).filter((id) => Number.isFinite(id) && id > 0)),
    [documents]
  );

  const attachmentsForEstimates = useMemo(
    () => attachments.filter((a) => estimateDocIds.has(Number(a.docid))),
    [attachments, estimateDocIds]
  );

  const docIdToPatientId = useMemo(
    () => buildDocIdToPatientIdMap(attachmentsForEstimates),
    [attachmentsForEstimates]
  );

  const documentWorkItems = useMemo(
    () =>
      buildDocumentEstimateWorkItems(documents, docIdToPatientId, patientsById, {
        lookback: documentLookback,
      }),
    [documents, docIdToPatientId, patientsById, documentLookback]
  );

  const lookbackLabel =
    ESTIMATE_DOCUMENT_LOOKBACK_OPTIONS.find((o) => o.id === documentLookback)?.label ?? 'Up to 1 month';

  const nextAppointmentByPatientId = useMemo(
    () => buildNextAppointmentLabelByPatientId(appointments, patientInfoById),
    [appointments, patientInfoById]
  );

  const openDocumentItem = (item: (typeof documentWorkItems)[0]) => {
    const fu = followUpByDocId[item.followUpDocId];
    if (!fu) return true;
    if (item.workflowStatus === 'covered_eob') return fu.documentCoveredNoted !== true;
    return isOpenOutreachItem(fu as Record<string, unknown>);
  };

  const mapDocumentRow = (d: (typeof documentWorkItems)[0]): DocumentEstimateRow => {
    const fu = followUpByDocId[d.followUpDocId];
    const patientLedger = ledgerByPatientId.get(Number(d.patientId)) ?? [];
    const procedureContext = buildDocumentProcedureContext({
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
    return {
      docId: d.docId,
      followUpDocId: d.followUpDocId,
      patientId: d.patientId,
      patientName: d.patientName,
      descript: d.descript,
      createdLabel: d.createdLabel,
      documentStatus: d.workflowStatus,
      nextApptInSystem: nextAppointmentByPatientId[d.patientId] ?? '—',
      procedureContext,
      codeTypeFilterId: primaryCodeTypeFilterId(procedureContext),
      outcome: fu ? String(fu.outcome ?? '') : undefined,
      notes: fu ? String(fu.notes ?? '') : undefined,
      lastNoteAt: fu ? String(fu.lastNoteAt ?? '') : undefined,
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
      .map(mapDocumentRow);
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
  ]);

  const predFollowUpRows = useMemo<DocumentEstimateRow[]>(() => {
    return documentWorkItems
      .filter((d) => isPredFollowUpDocumentStatus(d.workflowStatus))
      .filter(openDocumentItem)
      .filter((d) => {
        const p = patientsById[d.patientId];
        return !p || isActiveDentrixPatient(p);
      })
      .map(mapDocumentRow);
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
  ]);

  const activeTabRows = tab === 'pred_approved' ? predApprovedRows : predFollowUpRows;

  const ledgerPatientIds = useMemo(
    () => [...new Set(activeTabRows.map((r) => r.patientId))],
    [activeTabRows]
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
        activeTabRows
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
  }, [activeTabRows, coverageByPlanId]);

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

  const handleMarkBooked = async (row: DocumentEstimateRow) => {
    setUpdatingId(row.followUpDocId);
    await upsertDocumentFollowUp(row, {
      status: 'booked',
      outcome: 'Booked — pre-d / explanation document',
      nextAppointmentBooked: true,
    });
    setUpdatingId(null);
  };

  const handleMarkCovered = async (row: DocumentEstimateRow) => {
    setUpdatingId(row.followUpDocId);
    await upsertDocumentFollowUp(row, {
      status: 'covered_eob',
      outcome: 'Approved — explanation of benefits on file',
      documentCoveredNoted: true,
      nextAppointmentBooked: true,
    });
    setUpdatingId(null);
  };

  const saveEstimateOutreach = async (row: DocumentEstimateRow, payload: OutreachLogPayload) => {
    setSavingId(row.followUpDocId);
    const prev = followUpByDocId[row.followUpDocId];
    const entry = {
      at: new Date().toISOString(),
      channel: payload.channel,
      reached: payload.reached,
      outcome: payload.outcome,
      notes: payload.notes,
      callbackDate: payload.callbackDate || null,
      by: authorName,
    };
    const prevHistory = Array.isArray(prev?.outreachHistory) ? (prev.outreachHistory as Array<Record<string, unknown>>) : [];
    const outreachHistory = [...prevHistory, entry].slice(-25);
    const summary = `${payload.channel} / ${payload.reached}${payload.outcome ? ` — ${payload.outcome}` : ''}`;

    const notePatch = payload.notes.trim()
      ? appendTimestampedFollowUpNote(row.notes, payload.notes, authorName)
      : { notes: row.notes, lastNoteAt: row.lastNoteAt, lastNoteBy: prev?.lastNoteBy };

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
        status: 'estimate_followup',
        outcome: summary,
        lastOutreach: entry,
        outreachHistory,
        ...notePatch,
        nextAppointmentBooked: false,
        category: row.procedureContext.primaryCodeType?.label ?? row.descript,
        procedure_codes: row.procedureContext.procedureCodes.map((c) => c.code),
        code_type: row.procedureContext.primaryCodeType?.label ?? null,
      },
      { merge: true }
    );
    if (user?.uid && user.email) {
      await logActivity({
        userId: user.uid,
        userEmail: user.email,
        userName: authorName,
        action: `Pre-d follow-up: ${row.patientName}`,
        section: ACTIVITY_SECTION_FOLLOW_UP_OUTREACH,
        detail: buildOutreachActivityDetail({
          channel: payload.channel,
          reached: payload.reached,
          outcome: payload.outcome,
          notes: payload.notes,
          callbackDate: payload.callbackDate,
          patientId: row.patientId,
          queue: 'outreach',
        }),
      });
      if (payload.notes.trim()) {
        await logAudit({
          entityType: 'followUp',
          entityId: String(row.docId),
          action: 'note_added',
          field: 'notes',
          newValue: payload.notes.trim(),
          userId: user.uid,
          userEmail: user.email,
          userName: authorName,
          detail: row.patientName,
        });
      }
    }
    setSavingId(null);
    setLogRow(null);
  };

  const matchesSearch = (row: DocumentEstimateRow) => {
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
  };

  const matchesCodeTypeFilter = (row: DocumentEstimateRow) => {
    if (codeTypeFilter === ESTIMATE_CODE_TYPE_FILTER_ALL) return true;
    if (codeTypeFilter === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) {
      return row.codeTypeFilterId === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED;
    }
    return row.procedureContext.codeTypes.some((t) => t.groupId === codeTypeFilter);
  };

  const filterRows = (rows: DocumentEstimateRow[]) =>
    rows.filter(matchesSearch).filter(matchesCodeTypeFilter);

  const filteredApproved = filterRows(predApprovedRows);
  const filteredFollowUp = filterRows(predFollowUpRows);

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

  const renderDataRow = (
    r: DocumentEstimateRow,
    options: { showLog?: boolean; showBooked?: boolean; showCovered?: boolean }
  ) => {
    const { showLog = false, showBooked = false, showCovered = false } = options;
    return (
      <tr key={r.followUpDocId} className="hover:bg-slate-50/80">
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
        <td className="p-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">{r.createdLabel ?? '—'}</td>
        <td className="p-3 text-xs text-slate-700 max-w-[200px]">
          <p className="font-bold tabular-nums leading-snug">{r.nextApptInSystem}</p>
        </td>
        <td className="p-3 text-xs text-slate-500 max-w-[240px]">
          <p className="truncate">{r.outcome || '—'}</p>
          {r.notes && (
            <p className="text-[10px] text-slate-400 mt-1 truncate" title={r.notes}>
              {latestNotePreview(r.notes)}
            </p>
          )}
        </td>
        <td className="p-3 pr-4 text-right space-x-2 whitespace-nowrap">
          {showBooked && r.documentStatus === 'book_right_away' && (
            <Button
              size="sm"
              className="text-[9px] font-black uppercase bg-teal-600 hover:bg-teal-700"
              disabled={!!updatingId}
              onClick={() => handleMarkBooked(r)}
            >
              Mark booked
            </Button>
          )}
          {showCovered && r.documentStatus === 'covered_eob' && (
            <Button
              size="sm"
              variant="outline"
              className="text-[9px] font-black uppercase border-emerald-300 text-emerald-800"
              disabled={!!updatingId}
              onClick={() => handleMarkCovered(r)}
            >
              Mark noted
            </Button>
          )}
          {showLog && (
            <Button
              size="sm"
              variant="outline"
              className="text-[9px] font-black uppercase"
              disabled={!!savingId}
              onClick={() => setLogRow(r)}
            >
              Log follow-up
            </Button>
          )}
        </td>
      </tr>
    );
  };

  const renderTable = (
    rows: DocumentEstimateRow[],
    emptyLabel: string,
    options: { showLog?: boolean; showBooked?: boolean; showCovered?: boolean } = {}
  ) => {
    const colSpan = 7;
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
          <th className="p-3">Document date</th>
          <th className="p-3">Next appt in system</th>
          <th className="p-3">Last log / note</th>
          <th className="p-3 pr-4 text-right">Action</th>
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
          {sections.map((section) => (
            <div key={section.key} className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-700">{section.label}</h3>
                <span className="text-[10px] font-bold text-slate-500">{section.rows.length}</span>
              </div>
              <table className="w-full text-left text-sm min-w-[1180px]">
                {tableHead}
                <tbody className="divide-y divide-slate-100">
                  {section.rows.map((r) => renderDataRow(r, options))}
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
            {rows.map((r) => renderDataRow(r, options))}
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
            {id === 'pred_approved' && filteredApproved.length > 0 && (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-teal-500 text-white px-1.5 py-0.5 text-[9px]">
                {filteredApproved.length}
              </span>
            )}
            {id === 'pred_follow_up' && filteredFollowUp.length > 0 && (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-amber-500 text-white px-1.5 py-0.5 text-[9px]">
                {filteredFollowUp.length}
              </span>
            )}
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
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Document date</p>
            <Select
              value={documentLookback}
              onChange={(e) => setDocumentLookback(e.target.value as EstimateDocumentLookback)}
              className="h-10 w-[168px] text-xs font-bold"
            >
              {ESTIMATE_DOCUMENT_LOOKBACK_OPTIONS.map((o) => (
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
        {lookbackLabel}
        {' · '}
        <span className={documentLookback === 'all' ? 'text-amber-700' : 'text-slate-400'}>
          {documentLookback === 'all'
            ? 'All document history — may load slowly'
            : `${documents.length.toLocaleString()} document${documents.length === 1 ? '' : 's'} loaded`}
        </span>
      </p>

      {loading ? (
        <div className="p-24 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Loading…</div>
      ) : tab === 'pred_approved' ? (
        renderTable(filteredApproved, 'No pre-d approved or EOB documents', {
          showBooked: true,
          showCovered: true,
        })
      ) : (
        renderTable(filteredFollowUp, 'No pre-d acknowledgment documents to follow up', { showLog: true })
      )}

      <LogOutreachModal
        open={!!logRow}
        title="Log pre-d follow-up"
        patientLabel={logRow ? `${logRow.patientName} · ${logRow.descript}` : ''}
        onClose={() => setLogRow(null)}
        onSave={(payload) => (logRow ? saveEstimateOutreach(logRow, payload) : Promise.resolve())}
        saving={!!logRow && savingId === logRow.followUpDocId}
      />
    </div>
  );
};

export default FollowUpOutreachPage;
