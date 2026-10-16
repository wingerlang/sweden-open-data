/** Optional authenticated vehicle lookup; unlike the open sources, this requires a provider agreement. @module */
import {createContext,type ClientOptions} from '../core/context.ts';
import {SourceError} from '../core/errors.ts';
import type {ClientStats} from '../core/stats.ts';

/** Registry observations only. No owner, VIN, credit, or address data is retained. */
export interface VehicleRecord {
  registrationNumber:string;
  make?:string;
  model?:string;
  /** Manufacturer model year, falling back to vehicle year when unavailable. */
  modelYear?:number;
  vehicleYear?:number;
  annualTaxKr?:number;
  /** Last recorded inspection odometer; kilometres, not Swedish mil. */
  mileageKm?:number;
  lastInspectionDate?:string;
  nextInspectionDeadline?:string;
  firstRegistered?:string;
  source:'biluppgifter';
  fetchedAt:string;
}
/** A private, server-side client. Never put the API key in browser code. */
export interface VehicleClientOptions extends Omit<ClientOptions,'endpoints'|'store'> {
  apiKey:string;
  /** Memory-only positive cache lifetime. Default 6 hours. */
  ttlMs?:number;
}
/** A separately scoped client: authenticated results never enter the public clients' cache or persistent store. */
export interface VehicleClient {
  /** Returns null for HTTP 404. Invalid plates throw RangeError before any network request. */
  lookup(registrationNumber:string,options?:{signal?:AbortSignal}):Promise<VehicleRecord|null>;
  clearCache():void;
  stats():ClientStats;
  resetStats():void;
}
const SOURCE='biluppgifter';
const BASE='https://api.biluppgifter.se/api/v1/vehicle/regno/';
const REDACTED=BASE+'[redacted]';
/** Canonical Swedish plate, e.g. `abc 123` becomes `ABC123`. Throws for malformed input. */
export function normalizeVehicleRegistration(value:string):string {
  if(typeof value!=='string'||value.length>16)throw new RangeError('Invalid Swedish registration number');
  const plate=value.replace(/[\s-]/g,'').toUpperCase();
  if(!/^[A-Z]{3}[0-9]{2}[A-Z0-9]$/.test(plate))throw new RangeError('Invalid Swedish registration number');
  return plate;
}
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown):string|undefined=>typeof v==='string'&&v.trim()?v.trim():undefined;
const number=(v:unknown):number|undefined=>typeof v!=='number'&&typeof v!=='string'||v===''||typeof v==='string'&&!v.trim()?undefined:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):undefined;
const date=(v:unknown):string|undefined=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(v))return undefined;const day=v.slice(0,10),ms=Date.parse(day);return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===day?day:undefined;};
const year=(v:unknown):number|undefined=>{const n=number(v);return n!==undefined&&Number.isInteger(n)&&n>=1886&&n<=2200?n:undefined;};
const publicError=(e:SourceError):SourceError=>new SourceError('Vehicle lookup failed ('+e.code+')',{source:SOURCE,code:e.code,status:e.status,retryAfterMs:e.retryAfterMs,url:REDACTED});
/**
 * Parses documented Biluppgifter v1 basic/status/inspection packages, preserving missing values and zero tax.
 * Throws SourceError for an empty or mismatched response. No inspection dates are calculated.
 * @example parseBiluppgifterVehicle(payload, 'ABC123', '2026-10-16T12:00:00Z')
 */
export function parseBiluppgifterVehicle(payload:unknown,registrationNumber:string,fetchedAt:string):VehicleRecord {
  const plate=normalizeVehicleRegistration(registrationNumber),data=object(object(payload).data),attrs=object(data.attributes);
  const b=object(object(data.basic).data),s=object(object(data.status).data),i=object(object(data.inspection).data);
  const registered=text(attrs.regno);
  if(registered&&registered.replace(/\s/g,'').toUpperCase()!==plate)throw new SourceError('Vehicle registration did not match',{source:SOURCE,code:'invalid-response',url:REDACTED});
  const result:VehicleRecord={registrationNumber:plate,make:text(b.make),model:text(b.model),modelYear:year(b.model_year)??year(b.vehicle_year),vehicleYear:year(b.vehicle_year),annualTaxKr:number(s.tax),mileageKm:number(i.meter),lastInspectionDate:date(i.latest_inspection),nextInspectionDeadline:date(i.inspection_valid_until),firstRegistered:date(s.first_registered),source:SOURCE,fetchedAt};
  if(!result.make&&!result.model&&result.modelYear===undefined&&result.annualTaxKr===undefined&&result.mileageKm===undefined&&!result.lastInspectionDate&&!result.nextInspectionDeadline&&!result.firstRegistered)throw new SourceError('No usable vehicle observations',{source:SOURCE,code:'invalid-response',url:REDACTED});
  return result;
}
/**
 * Creates an opt-in, server-side lookup using Biluppgifter v1. Reuses shared HTTP retries/timeouts and bounded
 * in-memory caching. Plates, keys and upstream causes are removed from telemetry and returned errors.
 * @example const vehicles = createVehicleClient({apiKey: process.env.BILUPPGIFTER_API_KEY!});
 */
export function createVehicleClient(options:VehicleClientOptions):VehicleClient {
  if(typeof options?.apiKey!=='string'||!options.apiKey.trim()||/[\r\n]/.test(options.apiKey))throw new RangeError('A server-side Biluppgifter API key is required');
  const ttl=options.ttlMs??6*3_600_000;if(!Number.isFinite(ttl)||ttl<0)throw new RangeError('ttlMs must be non-negative');
  const {apiKey,ttlMs:_,...network}=options,request=options.fetch??globalThis.fetch;
  const ctx=createContext({...network,userAgent:options.userAgent||'sweden-open-data',fetch:(input,init)=>{const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+apiKey.trim());return request(input,{...init,headers,redirect:'error'});},onRequest:event=>options.onRequest?.({...event,url:REDACTED,error:event.error?publicError(event.error):undefined}),onCacheEvent:event=>options.onCacheEvent?.({...event,key:'vehicle:[redacted]'})});
  const load=async(plate:string,signal?:AbortSignal):Promise<VehicleRecord|null>=>{
    try{const raw=await ctx.http.json(SOURCE,BASE+encodeURIComponent(plate)+'?include=basic,status,inspection',{allowNotFound:true,signal});return raw===undefined?null:parseBiluppgifterVehicle(raw,plate,new Date(ctx.now()).toISOString());}
    catch(error){if(error instanceof SourceError)throw publicError(error);throw error;}
  };
  return Object.freeze({
    lookup:async(registrationNumber:string,lookupOptions?:{signal?:AbortSignal}):Promise<VehicleRecord|null>=>{const plate=normalizeVehicleRegistration(registrationNumber);if(lookupOptions?.signal){lookupOptions.signal.throwIfAborted();return load(plate,lookupOptions.signal);}return ctx.cache.get('vehicle:'+plate,v=>v===null?Math.min(ttl,300_000):ttl,()=>load(plate));},
    clearCache:()=>ctx.cache.clear(),stats:()=>ctx.stats.snapshot(),resetStats:()=>ctx.stats.reset(),
  });
}
