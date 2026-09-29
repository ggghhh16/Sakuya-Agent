import type { Page } from '@playwright/test';

/** Deterministic SDK contract double. This does not verify live AMap tiles. */
export async function mockMapSDK(page: Page) {
  await page.route('https://webapi.amap.com/maps?**', async route => {
    const callback = new URL(route.request().url()).searchParams.get('callback');
    await route.fulfill({contentType: 'text/javascript', body: `
      window.__mapCreated = window.__mapCreated || 0;
      window.__mapDestroyed = window.__mapDestroyed || 0;
      class MapDouble {
        constructor(host,options) {window.__mapStyle=options.mapStyle;
          this.host=host;this.handlers={};window.__mapCreated++;
          host.style.background='linear-gradient(32deg,#172532,#21343d)';
          const label=document.createElement('div');label.textContent='地图 SDK 测试替身 · 不含真实底图';label.style.cssText='padding:85px 35px;color:#879dad;font-size:12px';host.append(label);
          this.click=e=>{if(e.target.closest('button'))return;this.handlers.click?.({lnglat:{getLng:()=>113.3512,getLat:()=>23.1321}})};
          host.addEventListener('click',this.click);setTimeout(()=>this.handlers.complete?.({}),30);
        }
        on(n,f){this.handlers[n]=f} off(n){delete this.handlers[n]}
        add(items){for(const m of Array.isArray(items)?items:[items]){m.element.style.position='relative';m.element.style.display='inline-flex';m.element.style.margin='25px 12px';this.host.append(m.element)}}
        remove(items){for(const m of Array.isArray(items)?items:[items])m.element.remove()}
        destroy(){window.__mapDestroyed++;this.host.removeEventListener('click',this.click);this.host.replaceChildren()}
        setMapStyle(style){window.__mapStyle=style} setFitView(){window.__mapFitCalls=(window.__mapFitCalls||0)+1} setZoomAndCenter(z,c){window.__mapCenter=c;window.__mapZoom=z}
      }
      window.AMap={convertFrom(p,t,cb){window.__conversionInput={point:p,type:t};cb('complete',{locations:[{getLng:()=>p[0]+0.006,getLat:()=>p[1]+0.003}]})},Map:MapDouble,Marker:class {constructor(o){this.element=o.content}on(){}},Pixel:class{}};
      window[${JSON.stringify(callback)}]();
    `});
  });
}
