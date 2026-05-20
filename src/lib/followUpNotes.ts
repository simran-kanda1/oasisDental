import { format } from 'date-fns';

/** Append a staff note with date/time and author for display in follow-up UIs. */
export function appendTimestampedFollowUpNote(
  previous: string | undefined,
  text: string,
  author: string
): { notes: string; lastNoteAt: string; lastNoteBy: string } {
  const trimmed = text.trim();
  const stamp = format(new Date(), 'MMM d, yyyy h:mm a');
  const line = `[${stamp} · ${author}] ${trimmed}`;
  const notes = previous?.trim() ? `${previous.trim()}\n---\n${line}` : line;
  return { notes, lastNoteAt: new Date().toISOString(), lastNoteBy: author };
}

/** Most recent bracketed note line for compact table display. */
export function latestNotePreview(notes: string | undefined, maxLen = 80): string {
  if (!notes?.trim()) return '';
  const parts = notes.split('\n---\n');
  const last = parts[parts.length - 1]?.trim() ?? '';
  if (last.length <= maxLen) return last;
  return `${last.slice(0, maxLen - 1)}…`;
}
