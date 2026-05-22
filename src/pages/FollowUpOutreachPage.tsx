import React, { useMemo, useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, setDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
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
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  workflowStatusBadgeClass,
  workflowStatusLabel,
  type DentrixDocumentAttachmentDoc,
  type DentrixDocumentDoc,
  type DocumentEstimateWorkflowStatus,
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [logRow, setLogRow] = useState<DocumentEstimateRow | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const authorName = userProfile?.displayName ?? user?.email ?? 'User';

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let pending = 5;
    const done = () => {
      pending -= 1;
      if (pending <= 0) setLoading(false);
    };

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
    const unsubDocs = onSnapshot(collection(db, 'documents'), (snap) => {
      setDocuments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixDocumentDoc)));
      done();
    });
    const unsubAttach = onSnapshot(collection(db, 'document_attachments'), (snap) => {
      setAttachments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixDocumentAttachmentDoc)));
    });

    return () => {
      unsubA();
      unsubP();
      unsubInfo();
      unsubFu();
      unsubDocs();
      unsubAttach();
    };
  }, []);

  const docIdToPatientId = useMemo(() => buildDocIdToPatientIdMap(attachments), [attachments]);

  const documentWorkItems = useMemo(
    () => buildDocumentEstimateWorkItems(documents, docIdToPatientId, patientsById),
    [documents, docIdToPatientId, patientsById]
  );

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
    return {
      docId: d.docId,
      followUpDocId: d.followUpDocId,
      patientId: d.patientId,
      patientName: d.patientName,
      descript: d.descript,
      createdLabel: d.createdLabel,
      documentStatus: d.workflowStatus,
      nextApptInSystem: nextAppointmentByPatientId[d.patientId] ?? '—',
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
  }, [documentWorkItems, followUpByDocId, patientsById, nextAppointmentByPatientId]);

  const predFollowUpRows = useMemo<DocumentEstimateRow[]>(() => {
    return documentWorkItems
      .filter((d) => isPredFollowUpDocumentStatus(d.workflowStatus))
      .filter(openDocumentItem)
      .filter((d) => {
        const p = patientsById[d.patientId];
        return !p || isActiveDentrixPatient(p);
      })
      .map(mapDocumentRow);
  }, [documentWorkItems, followUpByDocId, patientsById, nextAppointmentByPatientId]);

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
        category: row.descript,
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
        category: row.descript,
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
    return (
      row.patientName.toLowerCase().includes(q) ||
      row.descript.toLowerCase().includes(q) ||
      row.patientId.toLowerCase().includes(q) ||
      row.nextApptInSystem.toLowerCase().includes(q)
    );
  };

  const filteredApproved = predApprovedRows.filter(matchesSearch);
  const filteredFollowUp = predFollowUpRows.filter(matchesSearch);

  const renderStatusBadge = (status: DocumentEstimateWorkflowStatus) => (
    <span
      className={`inline-flex mt-1 px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide ${workflowStatusBadgeClass(status)}`}
    >
      {workflowStatusLabel(status)}
    </span>
  );

  const renderTable = (
    rows: DocumentEstimateRow[],
    emptyLabel: string,
    options: { showLog?: boolean; showBooked?: boolean; showCovered?: boolean } = {}
  ) => {
    const { showLog = false, showBooked = false, showCovered = false } = options;
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1040px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
              <th className="p-3 pl-4">
                Patient
                <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                  Tap for contact card
                </span>
              </th>
              <th className="p-3">Document</th>
              <th className="p-3">Document date</th>
              <th className="p-3">Next appt in system</th>
              <th className="p-3">Last log / note</th>
              <th className="p-3 pr-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-xs text-slate-400 font-bold uppercase">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.followUpDocId} className="hover:bg-slate-50/80">
                  <td className="p-3 pl-4">
                    <PatientProfileTrigger patientId={r.patientId} className="normal-case font-bold text-left">
                      <p className="font-bold text-slate-900">{r.patientName}</p>
                      <p className="text-[10px] text-slate-400 font-normal pointer-events-none">ID {r.patientId}</p>
                    </PatientProfileTrigger>
                  </td>
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
              ))
            )}
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
          Document Center pre-determinations linked to patients.{' '}
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Input
          placeholder="Search patient, ID, document, or next appt…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md h-10 text-xs font-bold border-slate-200"
        />
      </div>

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
