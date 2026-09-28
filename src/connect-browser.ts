import {api} from './api';
import {tr} from './i18n';
import type {ProviderName} from './planner-types';
export async function connectInBrowser(name:ProviderName,config?:{client_id:string;client_secret:string}){
 const popup=window.sakuyaDesktop?.embedded?null:window.open('about:blank','_blank');
 if(popup)popup.opener=null;
 try{
  if(config)await api(`/integrations/${name}/config`,'PUT',config);
  const result=await api<{url:string}>(`/integrations/${name}/connect`,'POST');
  if(window.sakuyaDesktop?.openAuthorization){if(!await window.sakuyaDesktop.openAuthorization(result.url))throw new Error(tr('无法打开授权页面'));}
  else if(popup)popup.location.href=result.url;
  else throw new Error(tr('请允许弹出窗口后重试'));
  return result.url;
 }catch(e){popup?.close();throw e;}
}
