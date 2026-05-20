import React, { useMemo, useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import {
  logActivity,
  ACTIVITY_SECTION_FOLLOW_UP_OUTREACH,
  buildOutreachActivityDetail,
} from '../lib/activityLogger';
import { FOLLOW_UP_QUEUE_OUTREACH, isOpenOutreachItem } from '../lib/followUpQueues';
import { LogOutreachModal, type OutreachLogPayload } from '../components/LogOutreachModal';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import {
  buildDocIdToPatientIdMap,
  buildDocumentEstimateWorkItems,
  workflowStatusBadgeClass,
  workflowStatusLabel,
  type DentrixDocumentAttachmentDoc,
  type DentrixDocumentDoc,
  type DocumentEstimateWorkflowStatus,
} from '../lib/documentEstimates';
import { appendTimestampedFollowUpNote, latestNotePreview } from '../lib/followUpNotes';
import {
  cleanDentrixText,
  formatDentrixDateKey,
  formatDentrixTimeLabel,
  isActiveDentrixPatient,
  type DentrixAppointmentDoc,
  type DentrixPatientDoc,
} from '../lib/dentrix';
import {
  isEstimateAppointment,
  isEstimateSent,
  patientHasFutureEstimateTypeAppointment,
} from '../lib/appointmentHeuristics';

export type EstimateFollowUpHubTab = 'to_send' | 'book_now' | 'follow_up';

export interface FollowUpOutreachPageProps {
  /** When opening from legacy “Estimates” nav, start on send tab. */
  initialTab?: EstimateFollowUpHubTab;
}

interface ToSendRow {
  id: string;
  appointmentDocId: string;
  patientId: string;
  patientName: string;
  reason: string;
  provider: string;
  date: string | null;
  time: string;
  amount: number;
}

type FollowUpRowSource = 'appointment' | 'document';

interface FollowUpEstimateRow {
  source: FollowUpRowSource;
  apptId?: string;
  docId?: number;
  followUpDocId: string;
  patientId: string;
  patientName: string;
  reason: string;
  provider: string;
  dateLabel: string | null;
  timeLabel: string;
  documentStatus?: DocumentEstimateWorkflowStatus;
  outcome?: string;
  notes?: string;
  lastNoteAt?: string;
}

const FollowUpOutreachPage: React.FC<FollowUpOutreachPageProps> = ({ initialTab = 'to_send' }) => {
  const { user, userProfile } = useAuth();
  const [tab, setTab] = useState<EstimateFollowUpHubTab>(initialTab);
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [documents, setDocuments] = useState<DentrixDocumentDoc[]>([]);
  const [attachments, setAttachments] = useState<DentrixDocumentAttachmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
  const [followUpByDocId, setFollowUpByDocId] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [logRow, setLogRow] = useState<FollowUpEstimateRow | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const authorName = userProfile?.displayName ?? user?.email ?? 'User';

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let pending = 4;
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

  const openDocumentItem = (item: (typeof documentWorkItems)[0]) => {
    const fu = followUpByDocId[item.followUpDocId];
    if (!fu) return true;
    if (item.workflowStatus === 'covered_eob') return fu.documentCoveredNoted !== true;
    return isOpenOutreachItem(fu as Record<string, unknown>);
  };

  const bookNowRows = useMemo<FollowUpEstimateRow[]>(() => {
    return documentWorkItems
      .filter((d) => d.workflowStatus === 'book_right_away')
      .filter(openDocumentItem)
      .map((d) => {
        const fu = followUpByDocId[d.followUpDocId];
        return {
          source: 'document' as const,
          docId: d.docId,
          followUpDocId: d.followUpDocId,
          patientId: d.patientId,
          patientName: d.patientName,
          reason: d.descript,
          provider: 'Document Center',
          dateLabel: d.createdLabel,
          timeLabel: '',
          documentStatus: d.workflowStatus,
          outcome: fu ? String(fu.outcome ?? '') : undefined,
          notes: fu ? String(fu.notes ?? '') : undefined,
          lastNoteAt: fu ? String(fu.lastNoteAt ?? '') : undefined,
        };
      });
  }, [documentWorkItems, followUpByDocId]);

  const coveredRows = useMemo<FollowUpEstimateRow[]>(() => {
    return documentWorkItems
      .filter((d) => d.workflowStatus === 'covered_eob')
      .filter(openDocumentItem)
      .map((d) => {
        const fu = followUpByDocId[d.followUpDocId];
        return {
          source: 'document' as const,
          docId: d.docId,
          followUpDocId: d.followUpDocId,
          patientId: d.patientId,
          patientName: d.patientName,
          reason: d.descript,
          provider: 'Document Center',
          dateLabel: d.createdLabel,
          timeLabel: '',
          documentStatus: d.workflowStatus,
          outcome: fu ? String(fu.outcome ?? '') : undefined,
          notes: fu ? String(fu.notes ?? '') : undefined,
        };
      });
  }, [documentWorkItems, followUpByDocId]);

  const toSendRows = useMemo<ToSendRow[]>(() => {
    return appointments
      .filter((a) => Number(a.amount ?? 0) > 0 || Number(a.production_type ?? 0) > 0)
      .filter((a) => !isEstimateSent(a))
      .filter((a) => {
        const pid = String(a.patient_id ?? '');
        const p = patientsById[pid];
        if (!p) return true;
        return isActiveDentrixPatient(p);
      })
      .slice(0, 600)
      .map((a) => ({
        id: `dentrix-${a.id}`,
        appointmentDocId: a.id,
        patientId: String(a.patient_id ?? ''),
        patientName: cleanDentrixText(a.patient_name) || `Patient #${a.patient_id ?? a.id}`,
        reason: cleanDentrixText(a.reason) || 'Treatment plan',
        provider: cleanDentrixText(a.provider_id) || 'N/A',
        date: formatDentrixDateKey(a.appointment_date),
        time: formatDentrixTimeLabel(a.start_hour, a.start_minute),
        amount: Number(a.amount ?? 0),
      }));
  }, [appointments, patientsById]);

  const followUpRows = useMemo(() => {
    const now = new Date();
    const rows: FollowUpEstimateRow[] = [];

    for (const d of documentWorkItems) {
      if (d.workflowStatus !== 'needs_follow_up') continue;
      if (!openDocumentItem(d)) continue;
      const p = patientsById[d.patientId];
      if (p && !isActiveDentrixPatient(p)) continue;
      const fu = followUpByDocId[d.followUpDocId];
      rows.push({
        source: 'document',
        docId: d.docId,
        followUpDocId: d.followUpDocId,
        patientId: d.patientId,
        patientName: d.patientName,
        reason: d.descript,
        provider: 'Document Center',
        dateLabel: d.createdLabel,
        timeLabel: '',
        documentStatus: d.workflowStatus,
        outcome: fu ? String(fu.outcome ?? '') : undefined,
        notes: fu ? String(fu.notes ?? '') : undefined,
        lastNoteAt: fu ? String(fu.lastNoteAt ?? '') : undefined,
      });
    }

    for (const a of appointments) {
      if (!isEstimateAppointment(a) || !isEstimateSent(a)) continue;
      const pid = String(a.patient_id ?? '');
      if (!pid) continue;
      const p = patientsById[pid];
      if (p && !isActiveDentrixPatient(p)) continue;
      if (patientHasFutureEstimateTypeAppointment(pid, appointments, now)) continue;
      const followUpDocId = `dentrix-${a.id}`;
      const fu = followUpByDocId[followUpDocId];
      if (fu && !isOpenOutreachItem(fu as Record<string, unknown>)) continue;
      rows.push({
        source: 'appointment',
        apptId: a.id,
        followUpDocId,
        patientId: pid,
        patientName: cleanDentrixText(a.patient_name) || `Patient #${pid}`,
        reason: cleanDentrixText(a.reason) || cleanDentrixText(a.appointment_type) || 'Treatment plan',
        provider: cleanDentrixText(a.provider_id) || '—',
        dateLabel: formatDentrixDateKey(a.appointment_date),
        timeLabel: formatDentrixTimeLabel(a.start_hour, a.start_minute),
        outcome: fu ? String(fu.outcome ?? '') : undefined,
        notes: fu ? String(fu.notes ?? '') : undefined,
        lastNoteAt: fu ? String(fu.lastNoteAt ?? '') : undefined,
      });
    }

    rows.sort((a, b) => (b.dateLabel ?? '').localeCompare(a.dateLabel ?? ''));
    return rows;
  }, [appointments, patientsById, followUpByDocId, documentWorkItems]);

  const handleMarkSent = async (row: ToSendRow, type: string) => {
    setUpdatingId(row.id);
    await updateDoc(doc(db, 'appointments', row.appointmentDocId), { estimate_sent: true });
    await setDoc(
      doc(db, 'followUps', row.id),
      {
        source: 'dentrix',
        queue: FOLLOW_UP_QUEUE_OUTREACH,
        patient_id: Number(row.patientId),
        patient_name: row.patientName,
        lastChanged: new Date().toISOString(),
        contactedBy: authorName,
        outcome: `${type}: Estimate sent`,
        status: 'estimate_followup',
        nextAppointmentBooked: false,
        category: row.reason,
        provider_id: row.provider,
      },
      { merge: true }
    );
    if (user?.uid && user.email) {
      await logActivity({
        userId: user.uid,
        userEmail: user.email,
        userName: authorName,
        action: `Sent estimate: ${row.patientName}`,
        section: 'Estimates',
      });
    }
    setUpdatingId(null);
  };

  const upsertDocumentFollowUp = async (
    row: FollowUpEstimateRow,
    patch: Record<string, unknown>
  ) => {
    await setDoc(
      doc(db, 'followUps', row.followUpDocId),
      {
        source: 'document_center',
        queue: FOLLOW_UP_QUEUE_OUTREACH,
        patient_id: Number(row.patientId),
        patient_name: row.patientName,
        dentrix_doc_id: row.docId,
        document_descript: row.reason,
        document_workflow: row.documentStatus,
        lastChanged: new Date().toISOString(),
        contactedBy: authorName,
        category: row.reason,
        ...patch,
      },
      { merge: true }
    );
  };

  const handleMarkBooked = async (row: FollowUpEstimateRow) => {
    setUpdatingId(row.followUpDocId);
    await upsertDocumentFollowUp(row, {
      status: 'booked',
      outcome: 'Booked — explanation / predet document',
      nextAppointmentBooked: true,
    });
    setUpdatingId(null);
  };

  const handleMarkCovered = async (row: FollowUpEstimateRow) => {
    setUpdatingId(row.followUpDocId);
    await upsertDocumentFollowUp(row, {
      status: 'covered_eob',
      outcome: 'Covered — explanation of benefits on file',
      documentCoveredNoted: true,
      nextAppointmentBooked: true,
    });
    setUpdatingId(null);
  };

  const saveEstimateOutreach = async (row: FollowUpEstimateRow, payload: OutreachLogPayload) => {
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
        source: row.source === 'document' ? 'document_center' : 'dentrix',
        queue: FOLLOW_UP_QUEUE_OUTREACH,
        patient_id: Number(row.patientId),
        patient_name: row.patientName,
        dentrix_doc_id: row.docId,
        document_descript: row.source === 'document' ? row.reason : undefined,
        document_workflow: row.documentStatus,
        lastChanged: new Date().toISOString(),
        contactedBy: authorName,
        status: 'estimate_followup',
        outcome: summary,
        lastOutreach: entry,
        outreachHistory,
        ...notePatch,
        nextAppointmentBooked: false,
        category: row.reason,
        provider_id: row.provider,
      },
      { merge: true }
    );
    if (user?.uid && user.email) {
      await logActivity({
        userId: user.uid,
        userEmail: user.email,
        userName: authorName,
        action: `Estimate follow-up: ${row.patientName}`,
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
    }
    setSavingId(null);
    setLogRow(null);
  };

  const matchesSearch = (name: string, reason: string, patientId: string) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      name.toLowerCase().includes(q) ||
      reason.toLowerCase().includes(q) ||
      patientId.toLowerCase().includes(q)
    );
  };

  const filteredSend = toSendRows.filter((e) => matchesSearch(e.patientName, e.reason, e.patientId));
  const filteredBook = bookNowRows.filter((r) => matchesSearch(r.patientName, r.reason, r.patientId));
  const filteredFollow = followUpRows.filter((r) => matchesSearch(r.patientName, r.reason, r.patientId));
  const filteredCovered = coveredRows.filter((r) => matchesSearch(r.patientName, r.reason, r.patientId));

  const renderStatusBadge = (status?: DocumentEstimateWorkflowStatus) => {
    if (!status) return null;
    return (
      <span
        className={`inline-flex mt-1 px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide ${workflowStatusBadgeClass(status)}`}
      >
        {workflowStatusLabel(status)}
      </span>
    );
  };

  const renderFollowUpTable = (rows: FollowUpEstimateRow[], emptyLabel: string, showLog = true) => (
    <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[960px]">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
            <th className="p-3 pl-4">
              Patient
              <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">Tap for contact card</span>
            </th>
            <th className="p-3">Document / treatment</th>
            <th className="p-3">When</th>
            <th className="p-3">Last log / note</th>
            <th className="p-3 pr-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-12 text-center text-xs text-slate-400 font-bold uppercase">
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
                    {r.source === 'document' && (
                      <p className="text-[9px] text-teal-600 font-bold uppercase mt-1 pointer-events-none">Document Center</p>
                    )}
                  </PatientProfileTrigger>
                </td>
                <td className="p-3">
                  <p className="text-xs font-semibold text-slate-800">{r.reason}</p>
                  <p className="text-[10px] text-slate-500">{r.provider}</p>
                  {renderStatusBadge(r.documentStatus)}
                </td>
                <td className="p-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                  {r.dateLabel ?? '—'} {r.timeLabel}
                </td>
                <td className="p-3 text-xs text-slate-500 max-w-[260px]">
                  <p className="truncate">{r.outcome || '—'}</p>
                  {r.notes && (
                    <p className="text-[10px] text-slate-400 mt-1 truncate" title={r.notes}>
                      {latestNotePreview(r.notes)}
                    </p>
                  )}
                </td>
                <td className="p-3 pr-4 text-right space-x-2">
                  {r.documentStatus === 'book_right_away' && (
                    <Button
                      size="sm"
                      className="text-[9px] font-black uppercase bg-rose-600 hover:bg-rose-700"
                      disabled={!!updatingId}
                      onClick={() => handleMarkBooked(r)}
                    >
                      Mark booked
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

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-full mx-auto bg-white font-sans pb-20">
      <div className="border-b border-slate-100 pb-6">
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight uppercase">Estimate follow-up</h1>
        <p className="text-[11px] font-bold text-slate-500 mt-2 max-w-3xl">
          Treatment-plan estimates from appointments plus Document Center files linked to each patient (
          <span className="text-slate-700">explanation</span> → book right away,{' '}
          <span className="text-slate-700">explanation of benefits</span> → covered,{' '}
          <span className="text-slate-700">acknowledgment</span> → follow up if not approved). Referring doctors: update from
          the patient profile after outreach.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-4">
        {(
          [
            ['to_send', 'Estimates to send'],
            ['book_now', 'Book now (documents)'],
            ['follow_up', 'Follow up'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
              tab === id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {label}
            {id === 'book_now' && filteredBook.length > 0 && (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-rose-500 text-white px-1.5 py-0.5 text-[9px]">
                {filteredBook.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Input
          placeholder="Search patient, ID, or document…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md h-10 text-xs font-bold border-slate-200"
        />
      </div>

      {loading ? (
        <div className="p-24 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Loading…</div>
      ) : tab === 'to_send' ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                <th className="p-3 pl-4">Patient</th>
                <th className="p-3">Treatment</th>
                <th className="p-3">Schedule / amount</th>
                <th className="p-3 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSend.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center text-xs text-slate-400 font-bold uppercase">
                    No estimates waiting to send
                  </td>
                </tr>
              ) : (
                filteredSend.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/80">
                    <td className="p-3 pl-4">
                      <PatientProfileTrigger patientId={e.patientId} disabled={!e.patientId}>
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{e.patientName}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 pointer-events-none">ID {e.patientId || '—'}</p>
                      </PatientProfileTrigger>
                    </td>
                    <td className="p-3">
                      <p className="text-xs font-bold text-slate-800">{e.reason}</p>
                      <p className="text-[10px] text-slate-500 mt-1">{e.provider}</p>
                    </td>
                    <td className="p-3 text-xs text-slate-600">
                      <p className="font-bold tabular-nums">
                        {e.date ?? '—'} {e.time}
                      </p>
                      <p className="mt-1 font-black text-slate-800">${e.amount.toLocaleString()}</p>
                    </td>
                    <td className="p-3 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleMarkSent(e, 'Email')}
                        disabled={!!updatingId}
                        className="h-9 px-5 rounded-lg border border-slate-200 text-[10px] font-black uppercase bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
                      >
                        Mark sent
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : tab === 'book_now' ? (
        renderFollowUpTable(filteredBook, 'No explanation documents need booking', false)
      ) : (
        <div className="space-y-8">
          {renderFollowUpTable(filteredFollow, 'No estimate or acknowledgment follow-ups')}
          {filteredCovered.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">
                Covered — explanation of benefits on file
              </p>
              <div className="border border-emerald-200 rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[800px]">
                  <thead>
                    <tr className="bg-emerald-50 border-b border-emerald-100 text-[10px] font-black uppercase text-emerald-800">
                      <th className="p-3 pl-4">Patient</th>
                      <th className="p-3">Document</th>
                      <th className="p-3">Created</th>
                      <th className="p-3 pr-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-50">
                    {filteredCovered.map((r) => (
                      <tr key={r.followUpDocId}>
                        <td className="p-3 pl-4">
                          <PatientProfileTrigger patientId={r.patientId}>
                            <p className="text-xs font-bold text-slate-900">{r.patientName}</p>
                            <p className="text-[10px] text-slate-400 pointer-events-none">ID {r.patientId}</p>
                          </PatientProfileTrigger>
                        </td>
                        <td className="p-3 text-xs text-slate-700">{r.reason}</td>
                        <td className="p-3 text-xs tabular-nums">{r.dateLabel ?? '—'}</td>
                        <td className="p-3 pr-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[9px] font-black uppercase border-emerald-300 text-emerald-800"
                            disabled={!!updatingId}
                            onClick={() => handleMarkCovered(r)}
                          >
                            Mark noted
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <LogOutreachModal
        open={!!logRow}
        title="Log estimate follow-up"
        patientLabel={logRow ? `${logRow.patientName} · ${logRow.dateLabel ?? ''}` : ''}
        onClose={() => setLogRow(null)}
        onSave={(payload) => (logRow ? saveEstimateOutreach(logRow, payload) : Promise.resolve())}
        saving={!!logRow && savingId === logRow.followUpDocId}
      />
    </div>
  );
};

export default FollowUpOutreachPage;
