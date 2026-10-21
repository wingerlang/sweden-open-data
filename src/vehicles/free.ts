/**
 * Free public-page vehicle lookup from Transportstyrelsen. No credentials, owner data or access-control bypass.
 *
 * @experimental Transportstyrelsen publishes this page for people, not as an API, and no agreement covers
 * automated reading. Registration numbers can be personal data under GDPR. Kept out of the main entry point until
 * the terms are confirmed in writing;
 * import it from `@wingerlang/sweden-open-data/vehicles/free`.
 *
 * @module
 */
import {createContext,type ClientOptions} from '../core/context.ts';
import {SourceError} from '../core/errors.ts';
import {normalizeVehicleRegistration,type VehicleClient,type VehicleRecord} from './mod.ts';
const source='transportstyrelsen',base='https://fordon-fu-regnr.transportstyrelsen.se/UppgifterAnnatFordon/TillbakaTillFordonsuppgifter';
export function vehicleLookupLinks(registrationNumber:string):{transportstyrelsen:string;biluppgifter:string}{const plate=normalizeVehicleRegistration(registrationNumber);return {transportstyrelsen:base+'?Registreringsnummer='+encodeURIComponent(plate),biluppgifter:'https://biluppgifter.se/fordon/'+plate.toLowerCase()+'/'};}
const decode=(s:string)=>s.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,v:string)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(?:nbsp|amp|lt|gt|quot|aring|Aring|auml|Auml|ouml|Ouml);/g,v=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&aring;':'å','&Aring;':'Å','&auml;':'ä','&Auml;':'Ä','&ouml;':'ö','&Ouml;':'Ö'}[v]||v));
/** Parse labelled fields only. Blank and changed pages fail closed; odometer units are never assumed. */
export function parseTransportstyrelsenVehicle(html:string,registrationNumber:string,fetchedAt:string):VehicleRecord{
 const plate=normalizeVehicleRegistration(registrationNumber);if(html.length>2_000_000)throw new RangeError('Vehicle page too large');
 const fields=new Map<string,string>();
 const plain=(s:string)=>decode(s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
 for(const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)){const m=/<strong\b[^>]*>([\s\S]*?)<\/strong>\s*<br\s*\/?>([\s\S]*)/i.exec(match[1]);if(m){const key=plain(m[1]).toLocaleLowerCase('sv');if(!fields.has(key))fields.set(key,plain(m[2]));}}
 const get=(...labels:string[])=>labels.map(k=>fields.get(k)).find(Boolean),reg=get('registreringsnummer');
 if(!reg||normalizeVehicleRegistration(reg)!==plate)throw new SourceError('Vehicle page missing or mismatched',{source,code:'invalid-response'});
 const date=(v?:string)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:undefined;
 const number=(v?:string)=>{const n=Number(v?.replace(/[^0-9.,]/g,'').replace(',','.'));return v&&Number.isFinite(n)&&n>=0?n:undefined;};
 const mileage=get('mätarställning'),modelYear=number(get('årsmodell','fordonsår'));
 const result:VehicleRecord={registrationNumber:plate,source:'transportstyrelsen',fetchedAt,make:get('fabrikat','märke'),model:get('handelsbeteckning','modell'),modelYear:modelYear&&Number.isInteger(modelYear)&&modelYear>=1886&&modelYear<=2200?modelYear:undefined,annualTaxKr:number(get('årsskatt','fordonsskatt')),mileageKm:mileage&&/\bkm\b/i.test(mileage)?number(mileage):mileage&&/\bmil\b/i.test(mileage)?(number(mileage)??0)*10:undefined,lastInspectionDate:date(get('senast godkända besiktning','senaste besiktning')),nextInspectionDeadline:date(get('besiktas senast','besiktigas senast')),firstRegistered:date(get('i trafik första gången i sverige','påställt första gången i sverige','i trafik första gången'))};
 if(!result.make&&!result.model&&!result.nextInspectionDeadline)throw new SourceError('Vehicle page has no observations',{source,code:'invalid-response'});return result;
}
/** Best effort public HTML, not an official API contract. Falls back to a user-opened page when its format changes. */
export function createFreeVehicleClient(options:Omit<ClientOptions,'endpoints'|'store'>={}):VehicleClient{
 const request=options.fetch??globalThis.fetch,redacted=base+'?Registreringsnummer=[redacted]';
 const clean=(e:SourceError)=>new SourceError('Public vehicle lookup failed ('+e.code+')',{source,code:e.code,status:e.status,url:redacted});
 const ctx=createContext({...options,onRequest:e=>options.onRequest?.({...e,url:redacted,error:e.error?clean(e.error):undefined}),onCacheEvent:e=>options.onCacheEvent?.({...e,key:'vehicle:[redacted]'}),fetch:async(input,init)=>{const response=await request(input,{...init,headers:{Accept:'text/html','User-Agent':options.userAgent||'sweden-open-data'},redirect:'error'});if(!response.ok)return response;let size=0;const chunks:Uint8Array[]=[];const reader=response.body?.getReader();if(!reader)throw Error('Empty vehicle page');try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2_000_000){await reader.cancel();throw Error('Vehicle page too large');}chunks.push(part.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return new Response(JSON.stringify({html:new TextDecoder().decode(bytes)}),{status:200,headers:{'Content-Type':'application/json'}});}});
 const load=async(plate:string,signal?:AbortSignal)=>{try{const raw=await ctx.http.json(source,vehicleLookupLinks(plate).transportstyrelsen,{signal,allowNotFound:true}) as {html:string}|undefined;return raw?parseTransportstyrelsenVehicle(raw.html,plate,new Date(ctx.now()).toISOString()):null;}catch(e){if(e instanceof SourceError)throw clean(e);throw new SourceError('Public vehicle lookup failed',{source,code:'invalid-response',url:redacted});}};
 return Object.freeze({lookup:async(reg:string,o?:{signal?:AbortSignal})=>{const plate=normalizeVehicleRegistration(reg);if(o?.signal){o.signal.throwIfAborted();return load(plate,o.signal);}return ctx.cache.get('vehicle:'+plate,v=>v===null?60_000:6*3_600_000,()=>load(plate));},clearCache:()=>ctx.cache.clear(),stats:()=>ctx.stats.snapshot(),resetStats:()=>ctx.stats.reset()});
}
