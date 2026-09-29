import { useEffect, useRef, useState } from 'react';
import { Crosshair, LoaderCircle, RefreshCw, LocateFixed } from 'lucide-react';
import { readDeviceLocation, toMapLocation } from './device-location';
import type {MapLocation} from './device-location';
import { loadMapSDK } from './map-sdk';
import type { AMapMap, AMapMarker, AMapSDK } from './map-sdk';
import type { MapPlace } from './map-types';
import { groupPlaces } from './map-types';
import type { Entry } from './planner-types';
import { tr, useLocale } from './i18n';

export default function MapCanvas({jsKey, entries, selectedId, draft, picking, onSelect, onPick}: {
  jsKey: string; entries: Entry[]; selectedId: string; draft: MapPlace | null; picking: boolean;
  onSelect: (id: string) => void; onPick: (lng: number, lat: number) => void;
}) {
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AMapMap | null>(null), sdk = useRef<AMapSDK | null>(null);
  const markers = useRef<AMapMarker[]>([]), firstFit = useRef(false);
  const locationRequest = useRef(0), viewIntent = useRef(0), located = useRef(false);
  const [locationState, setLocationState] = useState<'pending'|'success'|'error'>('pending');
  const [locationMessage, setLocationMessage] = useState(''), [locationPoint, setLocationPoint] = useState<MapLocation|null>(null);
  const userView = () => {viewIntent.current++; firstFit.current = true;};
  async function locate() {
    const instance=map.current, api=sdk.current;
    if (!instance || !api) return;
    const request=++locationRequest.current, intent=viewIntent.current;
    setLocationState('pending'); setLocationMessage('');
    try {
      const result=await readDeviceLocation();
      if (request!==locationRequest.current || instance!==map.current) return;
      if (!result.ok) {
        setLocationState('error');
        setLocationMessage(result.reason==='denied'?'未获定位权限，请在系统或浏览器设置中允许位置访问':result.reason==='timeout'?'设备定位超时，可稍后重试':'设备暂未提供位置，请检查系统定位服务');
        return;
      }
      const point=await toMapLocation(api,result);
      if (request!==locationRequest.current || instance!==map.current) return;
      located.current=true; setLocationPoint(point); setLocationState('success');
      if (intent===viewIntent.current) {
        firstFit.current=true;
        const accuracy=point.accuracy;
        instance.setZoomAndCenter(accuracy!==null&&accuracy>5000?11:accuracy!==null&&accuracy>1000?13:accuracy!==null&&accuracy>200?15:17,[point.lng,point.lat]);
      }
    } catch {
      if (request===locationRequest.current && instance===map.current) {setLocationState('error');setLocationMessage('定位坐标转换失败，请稍后重试');}
    }
  }
  const handlers = useRef({onSelect, onPick, picking}); handlers.current = {onSelect, onPick, picking};
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [tilesLoading, setTilesLoading] = useState(true);
  const groups = groupPlaces(entries);
  const currentStyle = () => document.documentElement.dataset.theme === 'light' ? 'amap://styles/normal' : 'amap://styles/dark';
  useEffect(() => {
    const observer = new MutationObserver(() => map.current?.setMapStyle(currentStyle()));
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    return () => observer.disconnect();
  }, []);
  const signature = JSON.stringify(groups.map(g => [g.id, g.place.name, g.entries.map(e => [e.id, e.title, e.completed])]));
  const selectedPosition = groups.find(g => g.entries.some(e => e.id === selectedId))?.id;
  useEffect(() => {
    let disposed = false;
    let tileTimeout: number | undefined;
    setReady(false); setError(''); firstFit.current = false; located.current=false; viewIntent.current=selectedId||draft?1:0;
    setLocationPoint(null); setLocationState('pending'); setLocationMessage('');
    setTilesLoading(true);
    void loadMapSDK(jsKey).then(api => {
      if (disposed || !container.current) return;
      sdk.current = api;
      const instance = new api.Map(container.current, {zoom: 4, center: [104, 35], resizeEnable: true,
        mapStyle: currentStyle(), viewMode: '2D', showIndoorMap: false});
      map.current = instance;
      instance.on('click', e => { if (handlers.current.picking) handlers.current.onPick(e.lnglat.getLng(), e.lnglat.getLat()); });
      instance.on('complete', () => { if (!disposed) {clearTimeout(tileTimeout); setTilesLoading(false); setError('');} });
      tileTimeout = window.setTimeout(() => { if (!disposed) {setTilesLoading(false); setError('底图加载超时，请检查网络与高德配置');} }, 20000);
      // A constructed map can accept overlays before its tiles finish loading.
      setReady(true);
      void locate();
    }).catch(e => { if (!disposed) setError((e as Error).message); });
    const observer = new ResizeObserver(() => window.dispatchEvent(new Event('resize')));
    if (container.current) observer.observe(container.current);
    return () => { disposed = true; locationRequest.current++; clearTimeout(tileTimeout); observer.disconnect(); map.current?.destroy(); map.current = null; markers.current = []; };
  }, [jsKey, attempt]);
  useEffect(() => {
    if (!ready || !map.current || !sdk.current) return;
    const instance = map.current, api = sdk.current;
    instance.remove(markers.current);
    markers.current = groups.map((group, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `map-building-marker ${group.entries.some(e => e.id === selectedId) ? 'selected' : ''} ${group.entries.every(e => e.completed) ? 'completed' : ''}`;
      button.setAttribute('aria-label', `${group.place.name} · ${tr('{0} 项安排', [group.entries.length])}`);
      const number = document.createElement('b'); number.textContent = String(index + 1);
      const label = document.createElement('span'); label.textContent = group.place.name;
      button.append(number, label);
      if (group.entries.length > 1) { const count = document.createElement('small'); count.textContent = String(group.entries.length); button.append(count); }
      button.onclick = e => { e.stopPropagation(); handlers.current.onSelect(group.entries[0].id); };
      return new api.Marker({position: [group.place.lng, group.place.lat], content: button, anchor: 'bottom-center', offset: new api.Pixel(0, -4), zIndex: group.entries.some(e => e.id === selectedId) ? 130 : 110});
    });
    instance.add(markers.current);
    // Signature captures marker data without recreating overlays on each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signature, selectedId, locale]);
  useEffect(() => {
    if (ready && locationState==='error' && !located.current && !firstFit.current && markers.current.length) {
      map.current?.setFitView(markers.current,false,[70,70,70,70],18); firstFit.current=true;
    }
  }, [ready, locationState, signature]);
  useEffect(() => {
    if (!ready || !map.current || !sdk.current || !locationPoint) return;
    const dot=document.createElement('div'); dot.className='map-device-marker'; dot.setAttribute('role','img'); dot.setAttribute('aria-label',tr('我的位置')); dot.title=tr('我的位置');
    const marker=new sdk.current.Marker({position:[locationPoint.lng,locationPoint.lat],content:dot,anchor:'center',zIndex:105});
    const instance=map.current; instance.add(marker);
    return () => {if (map.current===instance) instance.remove(marker);};
  },[ready,locationPoint,locale]);
  useEffect(() => {
    if (!ready || !map.current || !sdk.current || !draft) return;
    const dot = document.createElement('div'); dot.className = 'map-draft-marker'; dot.textContent = tr('待保存');
    const marker = new sdk.current.Marker({position: [draft.lng, draft.lat], content: dot, anchor: 'bottom-center', zIndex: 160});
    const instance = map.current; userView(); instance.add(marker); instance.setZoomAndCenter(18, [draft.lng, draft.lat]);
    return () => { if (map.current === instance) instance.remove(marker); };
  }, [ready, draft, locale]);
  useEffect(() => {
    const p = groups.find(g => g.entries.some(e => e.id === selectedId))?.place;
    if (ready && p && !draft) {userView(); map.current?.setZoomAndCenter(18, [p.lng, p.lat]);}
  }, [ready, selectedId, selectedPosition]);
  return <div className={`map-canvas-wrap ${picking ? 'is-picking' : ''}`} onPointerDownCapture={userView} onWheelCapture={userView}>
    <div ref={container} className="map-canvas" aria-label={tr('今日地点地图')}/>
    {tilesLoading && !error && <div className="map-canvas-message" role="status"><LoaderCircle className="spin" size={24}/>{tr('正在加载地图…')}</div>}
    {error && <div className="map-canvas-message" role="alert"><strong>{tr(error)}</strong><button className="button" onClick={() => error.includes('刷新页面') ? location.reload() : setAttempt(n => n + 1)}><RefreshCw size={15}/>{tr('重试')}</button></div>}
    {ready && <><div className="map-view-controls"><button className="button" onClick={() => {userView();map.current?.setFitView(markers.current, false, [70, 70, 70, 70], 18);}} disabled={!markers.current.length}><Crosshair size={16}/>{tr('显示全部地点')}</button><button className="button" disabled={locationState==='pending'} onClick={() => void locate()}><LocateFixed size={16}/>{tr(locationState==='pending'?'正在定位…':'我的位置')}</button></div><div className={`map-location-status ${locationState==='error'?'failed':''}`} role="status">{locationState==='pending'?tr('正在获取设备位置…'):locationState==='error'?tr(locationMessage):locationPoint?.accuracy!==null&&locationPoint?.accuracy!==undefined?tr('定位精度约 {0} 米',[Math.max(1,Math.round(locationPoint.accuracy))]):tr('已获取设备位置')}</div></>}
    {picking && <div className="map-pick-hint" role="status">{tr('点击地图上的具体建筑，再保存地点')}</div>}
  </div>;
}
