import { getLocale } from './i18n';
import type { MapPlace, MapResolution } from './map-types';
export type TodoList = { map_enabled?: boolean; read_only?: boolean; id: string; name: string; color: string; google_calendar_id: string; ticktick_project_id: string; ticktick_region: 'dida' | 'ticktick' };
export type Entry = { map_resolution?: MapResolution | null; map_place?: MapPlace | null; map_revision?: number; parent_id?: string; pinned?: boolean; cancelled?: boolean; is_note?: boolean; id: string; title: string; list_id: string; notes: string; tags?: string[]; sync_list_id?: string; start: string | null; end: string | null; all_day: boolean; completed: boolean; priority: 'none' | 'low' | 'medium' | 'high'; kind: 'task' | 'event'; location: string; revision: number; sync_state?: string; sync_error?: string; remote?: Record<string, {id: string; version: string}>; read_only?: boolean };
export type PlannerData = { lists: TodoList[]; entries: Entry[]; preferences?: {sort: 'priority' | 'time' | 'title' | 'list' | 'none'; manual_order: string[]; default_calendar_list?: string; default_task_list?: string; list_order?: string[]} };
export type ProviderName = 'google' | 'dida' | 'ticktick';
export type Connections = Record<ProviderName, {configured: boolean; connected: boolean; auto_import?: boolean; import_status?: string; import_message?: string; client_id: string; secret_set: boolean; redirect_uri: string}>;
export const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localInput = (value: string) => { const d = new Date(value); return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const addDays = (date: Date, days: number) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
export const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const weekStart = (date: Date) => addDays(midnight(date), -(date.getDay() + 6) % 7);
export const clockTime = (value: string) => new Date(value).toLocaleTimeString(getLocale(), {hour: '2-digit', minute: '2-digit', hour12: false});
export function entryBody(e: Entry) { return {parent_id:e.parent_id,pinned:e.pinned,cancelled:e.cancelled,is_note:e.is_note,title: e.title, list_id: e.list_id, notes: e.notes, tags: e.tags, start: e.start, end: e.end, all_day: e.all_day, completed: e.completed, priority: e.priority, kind: e.kind, location: e.location, revision: e.revision}; }
export function blankEntry(list_id: string, kind: Entry['kind'] = 'task', start: string | null = null, end: string | null = null): Entry { return {id: '', title: '', list_id, notes: '', start, end, all_day: false, completed: false, priority: 'none', kind, location: '', revision: 1}; }
