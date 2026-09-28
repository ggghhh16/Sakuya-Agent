import { useRef, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { tr } from './i18n';
export default function PlanningSplit({accountId, kind, open, main, sidebar}: {accountId:string;kind:string;open:boolean;main:ReactNode;sidebar:ReactNode}) {
  const key=`sakuya-planning-width:${accountId}:${kind}`, root=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(()=>Math.max(150,Math.min(420,Number(localStorage.getItem(key))||210)));
  const resize=(value:number)=>{const next=Math.round(Math.max(150,Math.min(420,(root.current?.clientWidth||800)-220,value)));setWidth(next);localStorage.setItem(key,String(next));};
  return <div ref={root} className={`planning-split ${open?'with-planning':''}`} style={{'--planning-width':`${width}px`} as CSSProperties}><div className="planning-content">{main}</div>{open&&<><div className="planning-divider" role="separator" aria-label={tr('调整清单区域宽度')} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={150} aria-valuemax={420} tabIndex={0} onPointerDown={e=>{if(e.button===0){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);}}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))resize(root.current!.getBoundingClientRect().right-e.clientX);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();resize(e.key==='Home'?150:e.key==='End'?420:width+(e.key==='ArrowLeft'?10:-10));}}}/><div className="planning-aside">{sidebar}</div></>}</div>;
}
