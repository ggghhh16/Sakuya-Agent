import { useEffect, useRef, useState } from 'react';
import { ExternalLink, GripVertical, PanelLeft, PanelRight, X } from 'lucide-react';
import { tr } from './i18n';
export default function FeatureHeader({title,path,side,setSide,close,toast}:{title:string;path:string;side:string;setSide:(side:'left'|'right')=>void;close:()=>void;toast:(text:string)=>void}){
  const origin=useRef<{x:number;y:number}|null>(null),[dragging,setDragging]=useState(false),[target,setTarget]=useState('');
  useEffect(()=>{document.documentElement.dataset.featureDrag=String(dragging);return()=>{delete document.documentElement.dataset.featureDrag;};},[dragging]);
  const isWindowTarget=(x:number,y:number)=>x<0||x>innerWidth||y<0||y>innerHeight||!!window.sakuyaDesktop?.embedded&&y<=32;
  async function detach(screenX?:number,screenY?:number){
    try{
      const checks:Promise<boolean>[]=[];window.dispatchEvent(new CustomEvent('sakuya-before-detach',{detail:{checks}}));
      if(checks.length && !(await Promise.all(checks)).every(Boolean))return;
      if(window.sakuyaDesktop?.detachPanel){const result=await window.sakuyaDesktop.detachPanel({route:path,x:screenX,y:screenY});if(!result.ok)throw new Error(result.error||tr('无法打开独立窗口'));}
      else{const url=new URL(location.href);url.searchParams.set('panel','1');url.hash=path;const popup=window.open(url.toString(),'_blank','popup,width=1080,height=800');if(!popup)throw new Error(tr('请允许弹出窗口后重试'));popup.opener=null;}
      close();
    }catch(e){toast((e as Error).message);}
  }
  return <><div className={`feature-toolbar ${dragging?'feature-dragging':''}`} aria-label={tr('拖动功能区域')} onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button,input,select,a'))return;origin.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}}
    onPointerMove={e=>{if(!origin.current||!e.currentTarget.hasPointerCapture(e.pointerId))return;if(Math.abs(e.clientX-origin.current.x)+Math.abs(e.clientY-origin.current.y)<8)return;setDragging(true);setTarget(isWindowTarget(e.clientX,e.clientY)?'window':e.clientX<innerWidth/2?'left':'right');}}
    onPointerUp={e=>{const moved=origin.current&&Math.abs(e.clientX-origin.current.x)+Math.abs(e.clientY-origin.current.y)>=8;origin.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(!moved)return;if(isWindowTarget(e.clientX,e.clientY))void detach(e.screenX,e.screenY);else setSide(e.clientX<innerWidth/2?'left':'right');}}
    onPointerCancel={()=>{origin.current=null;setDragging(false);}} onLostPointerCapture={()=>{origin.current=null;setDragging(false);}}>
    <GripVertical size={15}/><span>{title}</span><div className="feature-toolbar-actions"><button className="icon-button" aria-label={tr(side==='left'?'移到右侧':'移到左侧')} onClick={()=>setSide(side==='left'?'right':'left')}>{side==='left'?<PanelRight size={16}/>:<PanelLeft size={16}/>}</button><button className="icon-button" aria-label={tr('在独立窗口打开')} onClick={()=>void detach()}><ExternalLink size={15}/></button><button className="icon-button" aria-label={tr('收起功能区域')} onClick={close}><X size={18}/></button></div></div>{dragging&&<div className={`feature-drop-preview drop-${target}`}>{tr(target==='window'?'松开后在独立窗口打开':target==='left'?'松开后移到左侧':'松开后移到右侧')}</div>}</>;
}
