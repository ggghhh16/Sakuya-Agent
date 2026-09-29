export interface AMapPoint { getLng(): number; getLat(): number }
export interface AMapMarker { on(name: string, handler: () => void): void }
export interface AMapMap {
  add(markers: AMapMarker | AMapMarker[]): void;
  remove(markers: AMapMarker | AMapMarker[]): void;
  destroy(): void;
  on(name: string, handler: (event: {lnglat: AMapPoint}) => void): void;
  off(name: string, handler: (event: {lnglat: AMapPoint}) => void): void;
  setZoomAndCenter(zoom: number, center: number[]): void;
  setMapStyle(style: string): void;
  setFitView(markers?: AMapMarker[], immediately?: boolean, padding?: number[], maxZoom?: number): void;
}
export interface AMapSDK {
  convertFrom(point:number[],type:'gps',callback:(status:string,result:{locations?:AMapPoint[]})=>void):void;
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Pixel: new (x: number, y: number) => unknown;
}
declare global {
  interface Window { AMap?: AMapSDK; _AMapSecurityConfig?: {serviceHost: string} }
}
let pending: Promise<AMapSDK> | undefined;
let loadedKey = '';
let serial = 0;
export function loadMapSDK(key: string): Promise<AMapSDK> {
  if (loadedKey && loadedKey !== key) return Promise.reject(new Error('地图配置已更新，请刷新页面'));
  if (window.AMap && loadedKey === key) return Promise.resolve(window.AMap);
  if (pending) return pending;
  loadedKey = key;
  window._AMapSecurityConfig = {serviceHost: `${location.origin}/_AMapService`};
  pending = new Promise<AMapSDK>((resolve, reject) => {
    const callback = `sakuyaMapReady${++serial}`;
    const callbacks = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timeout); delete callbacks[callback]; script.onerror = null; };
    const fail = () => { cleanup(); script.remove(); loadedKey = ''; pending = undefined; reject(new Error('地图加载失败，请检查网络与高德配置')); };
    const timeout = window.setTimeout(fail, 18000);
    callbacks[callback] = () => { cleanup(); if (window.AMap) resolve(window.AMap); else fail(); };
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&callback=${callback}`;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return pending;
}
