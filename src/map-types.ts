import type { Entry } from './planner-types';
import { localDay } from './planner-types';

export type MapPlace = {name: string; address: string; lng: number; lat: number; provider: 'amap'; coord_system: 'GCJ-02'; poi_id: string; source: 'search' | 'manual'; location_text?: string; auto_input?: string[]};
export type MapResolution = {input: string[]; query: string; status: 'no_location' | 'not_found' | 'ambiguous' | 'unconfigured' | 'error' | 'resolved'; message: string};
export const locationInput = (entry: Entry) => [entry.location || '', entry.title || '', entry.notes || ''];
export type MapConfig = {configured: boolean; search_configured: boolean; js_key: string; security_code_set: boolean; web_key_set: boolean; city: string};
export function todayEntries(entries: Entry[], now = new Date()): Entry[] {
  const day = localDay(now), start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return entries.filter(e => {
    if (!e.start || !e.end || e.cancelled || e.is_note) return false;
    return e.all_day ? e.start.slice(0, 10) <= day && e.end.slice(0, 10) > day
      : new Date(e.start) < end && new Date(e.end) > start;
  }).sort((a, b) => Number(b.all_day) - Number(a.all_day) || (a.all_day ? a.start!.localeCompare(b.start!) : +new Date(a.start!) - +new Date(b.start!)) || a.title.localeCompare(b.title));
}
export function entryPlace(entry: Entry): MapPlace | null {
  const p = entry.map_place;
  return p && p.location_text === (entry.location || '') && (!p.auto_input || JSON.stringify(p.auto_input) === JSON.stringify(locationInput(entry))) && Number.isFinite(p.lng) && Number.isFinite(p.lat) && p.coord_system === 'GCJ-02' ? p : null;
}
export function placeBody(p: MapPlace): MapPlace {
  return {name: p.name, address: p.address, lng: p.lng, lat: p.lat, provider: p.provider, coord_system: p.coord_system, poi_id: p.poi_id, source: p.source};
}
export function groupPlaces(entries: Entry[]) {
  const groups = new Map<string, {id: string; place: MapPlace; entries: Entry[]}>();
  entries.forEach(entry => {
    const p = entryPlace(entry);
    if (!p) return;
    const id = `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
    const group = groups.get(id) || {id, place: p, entries: []};
    group.entries.push(entry); groups.set(id, group);
  });
  return [...groups.values()];
}
