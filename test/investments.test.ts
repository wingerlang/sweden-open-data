import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestmentClient,navDiscount,parseInvestmentHoldings,parseInvestmentHistory,parseInvestmentCompanies,parseInvestmentOverview} from '../src/investments/mod.ts';
import {memoryStore} from '../src/core/cache.ts';
const companies=[{product:'INVE B',productName:'Investor B',privateNote:'never copy'}];
const history=[{date:Date.parse('2025-01-01'),productPrice:80,netAssetValuePrice:100,netAssetValueCalculatedPrice:90},{date:Date.parse('2026-01-01'),productPrice:120,netAssetValuePrice:100,netAssetValueCalculatedPrice:0}];
const holdings=[{holdingProduct:'A',holdingName:'A',holdingValue:75,category:'LST'},{holdingProduct:'B',holdingName:'B',holdingValue:25,category:'UNL'},{holdingProduct:'Debt',holdingName:'Debt',holdingValue:-10,category:'DBT'}];
test('NAV sign, unavailable values, holdings denominator and public field allowlists',()=>{
 assert.equal(navDiscount(0,100),100);assert.ok(Math.abs(navDiscount(80,100)!-20)<1e-9);assert.ok(Math.abs(navDiscount(120,100)!+20)<1e-9);assert.equal(navDiscount(10,0),null);assert.equal(navDiscount(10,null),null);
 assert.deepEqual(parseInvestmentHoldings(holdings).map(v=>v.weightPct),[75,25,null]);assert.deepEqual(parseInvestmentHoldings([]),[]);
 const points=parseInvestmentHistory([...history].reverse());assert.equal(points[0].date,'2025-01-01');assert.equal(points[1].estimatedDiscount,null);
 assert.deepEqual(parseInvestmentCompanies(companies),[{product:'INVE B',name:'Investor B',symbol:'INVE-B.ST'}]);
 for(const value of [null,{},[],[{product:'../escape',productName:'Bad'}]])assert.throws(()=>parseInvestmentCompanies(value));
 assert.throws(()=>parseInvestmentHistory([{date:0,productPrice:1}]));assert.throws(()=>parseInvestmentHoldings([{holdingValue:'100'}]));
});
test('investment requests are shared, durable, cancellable by network timeout and never overwrite last good data on failure',async()=>{
 let now=Date.parse('2026-10-20'),calls=0,fail=false;const store=memoryStore();
 const fetchImpl=async(input:string|URL|Request,init?:RequestInit)=>{calls++;assert.equal(init?.method,'POST');assert.match(String((init?.headers as any)['content-type']),/application\/json/);if(fail)return new Response('upstream',{status:503});const path=String(input);return Response.json(path.includes('getCompanies')?companies:path.includes('getChartDataPrice')?history:path.includes('getHoldingsDate')?Date.parse('2026-01-01'):path.includes('getHoldings')?holdings:{netAssetValueChangeDate:Date.parse('2026-01-01')});};
 const options={store,fetch:fetchImpl as typeof fetch,now:()=>now,retries:0};const client=createInvestmentClient(options);
 await assert.rejects(client.company('../bad'));assert.equal(calls,0);
 const rows=await Promise.all(Array.from({length:8},()=>client.company('INVE B')));assert.equal(calls,5);assert.equal(rows[0].history.length,2);assert.equal(rows[0].holdingsDate,'2026-01-01');assert.ok(!JSON.stringify(rows).includes('privateNote'));
 const restored=createInvestmentClient(options);await restored.company('INVE B');assert.equal(calls,5,'restart uses durable cache');
 now+=7*3600000;fail=true;const stale=await createInvestmentClient(options).company('INVE B');assert.equal(stale.stale,true);assert.equal(stale.history.length,2);assert.equal(stale.fetchedAt,rows[0].fetchedAt);
 await assert.rejects(createInvestmentClient({fetch:fetchImpl as typeof fetch,retries:0}).company('INVE B'));
 await assert.rejects(client.company('UNKNOWN'));assert.equal(JSON.stringify(rows[0].company).includes('privateNote'),false);
});

test('overview is one small cached public request and retains category names and size metadata',async()=>{
 const catalog=[{...companies[0],marketWeight:71.3}],rows=[{product:'INVE B',price:80,netAssetValue:100,netAssetValueCalculated:0,netAssetValueChangeDate:Date.parse('2026-01-01'),privateNote:'never copy'}];
 assert.equal(parseInvestmentCompanies(catalog)[0].marketWeight,71.3);
 assert.equal(parseInvestmentHoldings([{holdingName:'Private',holdingValue:10,category:'ULT',categoryName:'Onoterade',privateNote:'never copy'}])[0].categoryName,'Onoterade');
 assert.equal(parseInvestmentHoldings(holdings)[0].categoryName,undefined,'old category-only responses remain valid');
 const parsed=parseInvestmentOverview(rows,parseInvestmentCompanies(catalog));assert.ok(Math.abs(parsed[0].reportedDiscount!-20)<1e-9);assert.equal(parsed[0].estimatedDiscount,null);assert.ok(!JSON.stringify(parsed).includes('privateNote'));
 assert.deepEqual(parseInvestmentOverview([{product:'UNKNOWN'}],parseInvestmentCompanies(catalog)),[]);assert.throws(()=>parseInvestmentOverview([{product:'INVE B',price:null}],parseInvestmentCompanies(catalog)));
 let count=0,now=Date.parse('2026-10-20'),fail=false;const store=memoryStore(),options={store,now:()=>now,retries:0,fetch:(async(url:any)=>{count++;if(fail)return new Response('',{status:503});assert.ok(!String(url).includes('getChartData'));return Response.json(String(url).includes('getCompanies')?catalog:rows);}) as typeof fetch};
 const client=createInvestmentClient(options);const values=await Promise.all(Array.from({length:5},()=>client.overview()));assert.equal(count,2);assert.equal(values[0].companies[0].marketWeight,71.3);
 await createInvestmentClient(options).overview();assert.equal(count,2);now+=7*3600000;fail=true;const stale=await createInvestmentClient(options).overview();assert.equal(stale.stale,true);assert.deepEqual(stale.companies,values[0].companies);
});
