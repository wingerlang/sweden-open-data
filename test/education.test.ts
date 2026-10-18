import test from 'node:test';
import assert from 'node:assert/strict';
import {getSwedishInstitutions,searchSwedishInstitutions,SWEDISH_INSTITUTIONS_SOURCE} from '../src/education/mod.ts';
test('UKÄ snapshot has 50 distinct stable identities, public facts and immutable rows',()=>{
 const rows=getSwedishInstitutions();assert.equal(rows.length,50);assert.equal(new Set(rows.map(r=>r.id)).size,50);
 for(const row of rows){assert.match(row.id,/^se:[a-z-]+$/);assert.equal(new URL(row.website).protocol,'https:');assert.equal(row.countryCode,'SE');assert.ok(Object.isFrozen(row));assert.ok(Object.isFrozen(row.aliases));assert.deepEqual(Object.keys(row).sort(),['aliases','countryCode','id','kind','name','website']);}
 assert.ok(Object.isFrozen(rows));assert.equal(SWEDISH_INSTITUTIONS_SOURCE.checkedAt,'2026-10-18');assert.match(SWEDISH_INSTITUTIONS_SOURCE.url,/uka.se/);
});
test('autocomplete understands abbreviations, accents, old names and result bounds without changing reference data',()=>{
 assert.equal(searchSwedishInstitutions('  kth ')[0].id,'se:kth');assert.equal(searchSwedishInstitutions('MDH')[0].id,'se:mdu');assert.equal(searchSwedishInstitutions('Jönköping University')[0].id,'se:ju');
 assert.ok(searchSwedishInstitutions('orebro').some(r=>r.id==='se:oru'));assert.ok(searchSwedishInstitutions('tekniska',50).length>=4);
 assert.equal(searchSwedishInstitutions('',2).length,2);assert.equal(searchSwedishInstitutions('',0).length,0);assert.equal(searchSwedishInstitutions('',-1).length,0);assert.equal(searchSwedishInstitutions('',NaN).length,10);assert.equal(searchSwedishInstitutions('',999).length,50);assert.equal(searchSwedishInstitutions('',2.9).length,2);assert.deepEqual(searchSwedishInstitutions('not an institution'),[]);
 assert.equal(getSwedishInstitutions().length,50);
});
