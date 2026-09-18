import React, { useCallback, useEffect, useRef, useState } from 'react';
import { searchPatients, type PatientSearchResult } from '../lib/patientSearch';
import { usePatientProfile } from '../contexts/PatientProfileContext';
import { Skeleton } from './ui/skeleton';
import { Button } from './ui/button';

export const GlobalPatientSearch: React.FC = () => {
  const { openPatient } = usePatientProfile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const runSearch = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await searchPatients(term);
      setResults(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch, open]);

  const pick = (row: PatientSearchResult) => {
    openPatient(row.patientId || row.firestoreId);
    close();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:border-teal-300 hover:bg-white transition-colors min-w-[200px] lg:min-w-[260px]"
      >
        <span className="text-xs font-medium flex-1 text-left">Search patients</span>
        <kbd className="text-[10px] text-slate-400 border border-slate-200 rounded-md px-1.5 py-0.5 bg-white">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600"
      >
        Search
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[10vh] px-4">
          <button type="button" className="absolute inset-0 bg-slate-900/20" aria-label="Close" onClick={close} />
          <div
            ref={panelRef}
            className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Search patients"
          >
            <div className="flex items-center gap-2 px-3 border-b border-slate-200">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, patient ID, phone, or email…"
                className="flex-1 h-12 text-sm outline-none bg-transparent placeholder:text-slate-400"
              />
              <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg shrink-0" onClick={close}>
                Close
              </Button>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {loading && (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              )}
              {!loading && query.trim().length < 2 && (
                <p className="p-6 text-center text-sm text-slate-500">Type at least 2 characters</p>
              )}
              {!loading && query.trim().length >= 2 && results.length === 0 && (
                <p className="p-6 text-center text-sm text-slate-500">No patients found</p>
              )}
              {!loading &&
                results.map((row) => (
                  <button
                    key={row.firestoreId}
                    type="button"
                    onClick={() => pick(row)}
                    className="w-full px-4 py-3 text-left hover:bg-teal-50 border-b border-slate-100 last:border-0"
                  >
                    <p className="text-sm font-medium text-slate-900 truncate">{row.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      ID {row.patientId}
                      {row.phone ? ` · ${row.phone}` : ''}
                    </p>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
