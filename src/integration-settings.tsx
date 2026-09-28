import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import {connectInBrowser} from './connect-browser';
import { tr, useLocale } from './i18n';
import type { Connections, ProviderName } from './planner-types';
import { ConnectionSettings } from './planner';
import { Presence } from './motion';

const importRange=()=>({start:new Date(Date.now()-60*86400000).toISOString(),end:new Date(Date.now()+120*86400000).toISOString()});
type ImportResult={ok:boolean;errors:{message:string}[];imported_lists:number};
export function AutoImport({accountId,toast}:{accountId:string;toast:(message:string)=>void}){
  const cache=useQueryClient(),running=useRef(false);
  useEffect(()=>{
    let cancelled=false;
    const errorKey = `sakuya-import-error:${accountId}`;
    const notifyError = (message: string) => {
      if (cancelled || localStorage.getItem(errorKey) === message) return;
      localStorage.setItem(errorKey, message);
      toast(message);
    };
    const tick=async()=>{
      if(running.current)return;
      const key=`sakuya-last-import:${accountId}`;
      const run=async()=>{
        if(Date.now()-Number(localStorage.getItem(key)||0)<60000)return;
        running.current=true;
        try{
          const status=await api<Connections>('/integrations');
          if(cancelled||!Object.values(status).some(c=>c.connected&&c.auto_import))return;
          localStorage.setItem(key,String(Date.now()));
          const result=await api<ImportResult>('/integrations/import','POST',{...importRange(),automatic:true});
          if(!cancelled){void cache.invalidateQueries({queryKey:['planner']});if(!result.ok)notifyError(tr('自动导入未完成：{0}',[Array.from(new Set(result.errors.map(e=>e.message))).join('；')]));else localStorage.removeItem(errorKey);}
        }catch(e){notifyError((e as Error).message);}finally{running.current=false;}
      };
      if(navigator.locks)await navigator.locks.request(`sakuya-import:${accountId}`,{ifAvailable:true},lock=>lock?run():Promise.resolve());else await run();
    };
    const initial=window.setTimeout(()=>void tick(),0),timer=window.setInterval(()=>void tick(),60000);
    return()=>{cancelled=true;clearTimeout(initial);clearInterval(timer);};
  },[accountId,cache,toast]);
  return null;
}
export default function IntegrationSettings({accountId}:{accountId:string}){
  useLocale();const cache=useQueryClient();
  const query=useQuery({queryKey:['integrations'],queryFn:()=>api<Connections>('/integrations'),refetchInterval:5000});
  const [provider,setProvider]=useState<ProviderName|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function importNow(name:ProviderName){setBusy(true);setMessage('');try{const result=await api<ImportResult>('/integrations/import','POST',{...importRange(),providers:[name]});setMessage(result.ok?tr('已导入，新增 {0} 个清单',[result.imported_lists]):result.errors.map(e=>e.message).join('；'));void cache.invalidateQueries({queryKey:['planner']});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section className="settings-section integration-settings"><h2>{tr('日历与任务连接')}</h2><p className="muted">{tr('连接后自动发现清单并导入内容；本地未同步修改会保留。')}</p>{(['google','dida','ticktick'] as ProviderName[]).map(name=><div className="integration-setting-row" key={name}><div><strong>{name==='google'?tr('Google 日历'):name==='dida'?tr('滴答清单'):'TickTick'}</strong><small>{tr(query.data?.[name].connected?'已连接':query.data?.[name].configured?'已识别连接配置':'尚未连接')}</small>{query.data?.[name].import_status&&<small role="status">{tr(query.data[name].import_status==='running'?'正在自动识别并导入…':query.data[name].import_status==='done'?'自动导入完成':'导入未完成，请重试')}{query.data[name].import_message}</small>}</div><button className="button primary" disabled={busy} onClick={async()=>{if(query.data?.[name].connected){await importNow(name);return;}if(!query.data?.[name].configured){setProvider(name);setMessage(tr(name==='google'?'此版本尚未配置 Google 应用登录，需要开发者先完成应用注册。你无需填写 Client ID 或 Client Secret。':'尚未识别到 OAuth 配置，请先填写或导入配置。'));return;}setBusy(true);setMessage('');try{await connectInBrowser(name);setMessage(tr('请在浏览器授权，完成后会自动识别并导入。'));}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>{tr(query.data?.[name].connected?'导入已连接账号':'浏览器连接并导入')}</button><button className="button" onClick={()=>setProvider(name)}>{tr('连接设置')}</button><button className="button" disabled={busy||!query.data?.[name].connected} onClick={()=>void importNow(name)}>{tr('立即导入')}</button><label><input type="checkbox" checked={!!query.data?.[name].auto_import} disabled={busy||!query.data?.[name].connected} onChange={async e=>{const enabled=e.target.checked;const previous=query.data;cache.setQueryData<Connections>(['integrations'],old=>old?{...old,[name]:{...old[name],auto_import:enabled}}:old);setBusy(true);try{await api(`/integrations/${name}/auto-import`,'PUT',{enabled});await cache.invalidateQueries({queryKey:['integrations']});if(enabled)await importNow(name);}catch(err){cache.setQueryData(['integrations'],previous);setMessage((err as Error).message);}finally{setBusy(false);}}}/>{tr('自动导入')}</label></div>)}<p className="planner-muted">{tr('应用打开时每分钟导入一次，包含过去 60 天与未来 120 天的日程。导入不会向远程写入。')}</p>{message&&<p role="status" className="settings-message">{message}</p>}<Presence show={!!provider} className="dialog-presence">{provider&&<ConnectionSettings accountId={accountId} initialProvider={provider} close={()=>setProvider(null)}/>}</Presence></section>;
}
