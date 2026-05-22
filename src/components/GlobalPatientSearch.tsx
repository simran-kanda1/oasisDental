import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, User, X } from 'lucide-react';
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
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 280);
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
        className="hidden sm:flex items-center gap-2 h-8 px-3 rounded-md border border-slate-200 bg-slate-50/80 text-slate-500 hover:border-teal-200 hover:bg-white transition-colors min-w-[200px] lg:min-w-[260px]"
      >
        <Search size={14} className="shrink-0 text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-tight flex-1 text-left">Search patients</span>
        <kbd className="text-[8px] font-bold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 bg-white">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden p-2 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
        aria-label="Search patients"
      >
        <Search size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[10vh] px-4 pointer-events-none">
          <div
            ref={panelRef}
            className="pointer-events-auto w-full max-w-lg rounded-md border border-slate-200 bg-white shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Search patients"
          >
            <div className="flex items-center gap-2 px-3 border-b border-slate-200">
              <Search size={16} className="text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, patient ID, phone, or email…"
                className="flex-1 h-11 text-sm outline-none bg-transparent placeholder:text-slate-400"
              />
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={close} aria-label="Close search">
                <X size={16} />
              </Button>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {loading && (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              )}
              {!loading && query.trim().length < 2 && (
                <p className="p-6 text-center text-[11px] text-slate-500">Type at least 2 characters — searches all patients</p>
              )}
              {!loading && query.trim().length >= 2 && results.length === 0 && (
                <p className="p-6 text-center text-[11px] text-slate-500">No patients found</p>
              )}
              {!loading &&
                results.map((row) => (
                  <button
                    key={row.firestoreId}
                    type="button"
                    onClick={() => pick(row)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-teal-50 border-b border-slate-100 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                      <User size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 truncate">{row.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        ID {row.patientId}
                        {row.phone ? ` · ${row.phone}` : ''}
                      </p>
                    </div>
                  </button>
                ))}
            </div>
            <p className="px-3 py-2 text-[9px] text-slate-400 border-t border-slate-100">Click outside or press Esc to close</p>
          </div>
        </div>
      )}
    </>
  );
};
