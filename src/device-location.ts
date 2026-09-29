import type {AMapSDK} from './map-sdk';

export type DeviceLocation = {ok:true;latitude:number;longitude:number;accuracy:number|null} | {ok:false;reason:'denied'|'timeout'|'unavailable'};
export type MapLocation = {lng:number;lat:number;accuracy:number|null};

export function readDeviceLocation(): Promise<DeviceLocation> {
  if (window.sakuyaDesktop?.getDeviceLocation) return window.sakuyaDesktop.getDeviceLocation().catch(() => ({ok:false,reason:'unavailable'}));
  if (!navigator.geolocation) return Promise.resolve({ok:false,reason:'unavailable'});
  return new Promise(resolve => {
    let done=false;
    const finish=(result:DeviceLocation)=>{if (!done) {done=true;clearTimeout(timer);resolve(result);}};
    const timer=window.setTimeout(()=>finish({ok:false,reason:'timeout'}),14000);
    navigator.geolocation.getCurrentPosition(position=>finish({ok:true,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy}),
      error=>finish({ok:false,reason:error.code===1?'denied':error.code===3?'timeout':'unavailable'}),
      {enableHighAccuracy:true,timeout:10000,maximumAge:0});
  });
}

export function toMapLocation(sdk:AMapSDK, position:Extract<DeviceLocation,{ok:true}>):Promise<MapLocation> {
  return new Promise((resolve,reject)=>{
    if (!Number.isFinite(position.longitude)||Math.abs(position.longitude)>180||!Number.isFinite(position.latitude)||Math.abs(position.latitude)>90) return reject(new Error('invalid coordinates'));
    const timer=window.setTimeout(()=>reject(new Error('coordinate conversion timeout')),10000);
    try {
      sdk.convertFrom([position.longitude,position.latitude],'gps',(status,result)=>{
        clearTimeout(timer);
        const point=result.locations?.[0], lng=point?.getLng(), lat=point?.getLat();
        if (status!=='complete'||lng===undefined||lat===undefined||!Number.isFinite(lng)||!Number.isFinite(lat)) return reject(new Error('coordinate conversion failed'));
        resolve({lng,lat,accuracy:position.accuracy});
      });
    } catch(e) { clearTimeout(timer); reject(e); }
  });
}
