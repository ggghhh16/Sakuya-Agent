import {useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api} from './api';
import {entryPlace, locationInput} from './map-types';
import type {Entry, PlannerData} from './planner-types';

export function useAutoMap(entries: Entry[], configuration: number) {
  const cache = useQueryClient();
  const attempted = useRef(new Set<string>()), running = useRef(false), mounted = useRef(false);
  const [pending, setPending] = useState(''), [cycle, setCycle] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const retries = useRef(new Set<string>());
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    if (!configuration || running.current) return;
    const key = (entry: Entry) => JSON.stringify([entry.id, entry.revision, locationInput(entry), configuration]);
    const entry = entries.find(item => retries.current.has(item.id) || (!entryPlace(item) && !attempted.current.has(key(item))));
    if (!entry) return;
    const force = retries.current.delete(entry.id);
    attempted.current.add(key(entry)); running.current = true; setPending(entry.id);
    setErrors(previous => ({...previous, [entry.id]: ''}));
    void api<Entry>(`/maps/entries/${entry.id}/resolve`, 'POST', {revision: entry.revision, map_revision: entry.map_revision || 0, force}).then(updated => {
      if (!mounted.current) return;
      cache.setQueryData<PlannerData>(['planner'], data => data ? {...data, entries: data.entries.map(current => {
        // A poll or edit may have delivered newer content while lookup was running.
        return current.id === updated.id && current.revision === updated.revision && (current.map_revision || 0) <= (updated.map_revision || 0)
          && JSON.stringify(locationInput(current)) === JSON.stringify(locationInput(updated)) ? updated : current;
      })} : data);
    }).catch((error: Error) => {
      if (!mounted.current) return;
      setErrors(previous => ({...previous, [entry.id]: error.message}));
      void cache.invalidateQueries({queryKey: ['planner']});
    }).finally(() => {
      running.current = false;
      if (mounted.current) {setPending(''); setCycle(value => value + 1);}
    });
  }, [entries, configuration, cycle, cache]);
  return {pending, errors, retry: (id: string) => {retries.current.add(id); setCycle(value => value + 1);}};
}
