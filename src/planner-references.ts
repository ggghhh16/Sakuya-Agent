import type { Entry } from './planner-types';

export type PlannerReference = {id: string; title: string; kind: Entry['kind']; list_name: string; entry: Entry};
export const REFERENCE_MIME = 'application/x-sakuya-entry-ids';
export function writeEntryDrag(transfer: DataTransfer, ids: string[]) {
  transfer.setData(REFERENCE_MIME, JSON.stringify(ids));
  transfer.setData('text/sakuya-task', ids[0]);
  transfer.effectAllowed = 'copyMove';
}
export function readEntryDrag(transfer: DataTransfer): string[] {
  try {
    const value = JSON.parse(transfer.getData(REFERENCE_MIME) || 'null');
    if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string').slice(0, 30);
  } catch { /* Ignore unrelated external drag data. */ }
  const id = transfer.getData('text/sakuya-task');
  return id ? [id] : [];
}
export function dropEntryAt(x: number, y: number, ids: string[]) {
  if (!document.elementFromPoint(x, y)?.closest('[data-planner-reference-drop]')) return false;
  window.dispatchEvent(new CustomEvent('sakuya-attach-entries', {detail: ids}));
  return true;
}
