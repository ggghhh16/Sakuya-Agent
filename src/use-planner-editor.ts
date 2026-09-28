import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { entryBody } from './planner-types';
import type { Entry, PlannerData } from './planner-types';

/** Serialize automatic title saves and explicit full-form saves against one revision. */
export function usePlannerEditor(entry: Entry, autoTitle: boolean, paused: boolean, saved: () => void) {
  const cache = useQueryClient();
  const [draft, setState] = useState(entry);
  const latest = useRef(entry), baseline = useRef(entry);
  const pending = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [autoSaved, setAutoSaved] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const setDraft = useCallback((update: SetStateAction<Entry>) => {
    const next = typeof update === 'function' ? update(latest.current) : update;
    latest.current = next;
    setState(next);
  }, []);
  useEffect(() => { setDraft(entry); }, [entry, setDraft]);
  const acceptSaved = useCallback((value: Entry) => { baseline.current = value; setDraft(value); }, [setDraft]);
  const hasChanges = useCallback(() => {
    const normalized = (value: Entry) => {
      const {revision: _, ...body} = entryBody(value);
      return {...body, parent_id: value.parent_id || '', pinned: !!value.pinned, cancelled: !!value.cancelled, is_note: !!value.is_note, title: value.title.trim(), tags: [...new Set((value.tags || []).map(tag => tag.trim()).filter(Boolean))]};
    };
    return JSON.stringify(normalized(latest.current)) !== JSON.stringify(normalized(baseline.current));
  }, []);
  const persist = useCallback(async (titleOnly = false): Promise<boolean> => {
    // A click outside or on Save may arrive while a debounced request is in flight.
    while (pending.current) { if (!await pending.current) return false; }
    const current = latest.current;
    const title = current.title.trim();
    const base = baseline.current;
    if (titleOnly && (!autoTitle || current.read_only || !title || (current.id === base.id && title === base.title.trim()))) return true;
    if (!titleOnly && current.id && !hasChanges()) return true;
    if (current.read_only) return false;
    const snapshot = titleOnly && current.id && current.id === base.id ? {...base, title} : {...current, title};
    setBusy(true); setError('');
    const request = (async () => {
      try {
        const body = entryBody(snapshot), {revision: _, ...create} = body;
        const result = await api<Entry>(`/planner/entries${snapshot.id ? '/' + snapshot.id : ''}`, snapshot.id ? 'PUT' : 'POST', snapshot.id ? body : create);
        baseline.current = result;
        cache.setQueryData<PlannerData>(['planner'], old => old ? {...old, entries: [...old.entries.filter(e => e.id !== result.id), result]} : old);
        if (mounted.current) {
          // Keep edits typed during the request; adopt the server identity and revision.
          setDraft(d => ({...d, id: result.id, revision: result.revision, remote: result.remote, sync_state: result.sync_state,
            title: d.title === current.title ? result.title : d.title}));
          setAutoSaved(titleOnly);
        }
        saved();
        return true;
      } catch (err) {
        if (mounted.current) { setError((err as Error).message); setAutoSaved(false); }
        return false;
      } finally {
        pending.current = null;
        if (mounted.current) setBusy(false);
      }
    })();
    pending.current = request;
    return request;
  }, [autoTitle, cache, saved, setDraft, hasChanges]);
  useEffect(() => {
    if (!autoTitle || paused || draft.read_only || !draft.title.trim()) return;
    if (draft.id === baseline.current.id && draft.title.trim() === baseline.current.title.trim()) return;
    setAutoSaved(false);
    const timer = setTimeout(() => { void persist(true); }, 700);
    return () => clearTimeout(timer);
  }, [draft.title, autoTitle, paused, draft.read_only, persist]);
  return {draft, setDraft, acceptSaved, busy, setBusy, error, setError, autoSaved, persist, hasChanges};
}
