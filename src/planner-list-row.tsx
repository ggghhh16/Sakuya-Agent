import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Check } from 'lucide-react';
import { tr } from './i18n';
import type { TodoList } from './planner-types';
import type { MenuPoint } from './context-menu';

const listType = 'text/sakuya-list';
type Props = {
  listing: TodoList; count: number; selected?: boolean; visible?: boolean;
  select?: () => void; toggle?: () => void; edit: (list: TodoList, point: MenuPoint) => void;
  reorder: (source: string, target: string, after: boolean) => void;
  taskDrop?: (id: string) => void;
};

export default function PlannerListRow({listing, count, selected, visible, select, toggle, edit, reorder, taskDrop}: Props) {
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState('');
  const suppressClick = useRef(false);
  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(listType)) {
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      setDrop(event.clientY > box.top + box.height / 2 ? 'after' : 'before');
    } else if (taskDrop && event.dataTransfer.types.includes('text/sakuya-task')) {
      event.preventDefault(); setDrop('task');
    }
  };
  return <div data-list-id={listing.id} className={`planner-list-row ${selected ? 'selected' : ''} ${dragging ? 'list-dragging' : ''} ${drop ? 'list-drop-' + drop : ''}`}
    onContextMenu={event => { event.preventDefault(); edit(listing, {x: event.clientX, y: event.clientY}); }}
    onDragOver={dragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(''); }}
    onDrop={event => {
      event.preventDefault(); setDrop('');
      const source = event.dataTransfer.getData(listType);
      if (source) {
        const box = event.currentTarget.getBoundingClientRect();
        reorder(source, listing.id, event.clientY > box.top + box.height / 2);
      } else taskDrop?.(event.dataTransfer.getData('text/sakuya-task'));
    }}>
    {toggle && <button type="button" role="checkbox" aria-checked={visible} aria-label={tr('显示清单 {0}', [listing.name])}
      className="list-visibility" onClick={toggle}>
      <span className="list-dot" style={{background: visible ? listing.color : 'transparent', borderColor: listing.color}}>{visible && <Check size={10}/>}</span>
    </button>}
    <button type="button" className="planner-list" aria-label={listing.name} draggable
      onPointerDown={event => { if (event.button === 0) suppressClick.current = false; }}
      onDragStart={event => { suppressClick.current = true; setDragging(true); event.dataTransfer.setData(listType, listing.id); event.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragging(false); setDrop(''); }}
      onClick={() => { if (!suppressClick.current) select?.(); }}>
      {!toggle && <span className="list-dot" style={{background: listing.color, borderColor: listing.color}}/>}
      <span>{listing.name}</span><small>{count || ''}</small>
    </button>
  </div>;
}
