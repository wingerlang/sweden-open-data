/** Opt-in, paid contract test: set both variables intentionally; no default plate or requests. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleClient,normalizeVehicleRegistration} from '../src/vehicles/mod.ts';
const apiKey=process.env.BILUPPGIFTER_API_KEY,plate=process.env.VEHICLE_LIVE_TEST_REGISTRATION;
test('Biluppgifter: authenticated opt-in vehicle contract',{skip:!apiKey||!plate},async()=>{
 const client=createVehicleClient({apiKey:apiKey!,retries:0,cache:false,userAgent:'sweden-open-data contract test'});
 const vehicle=await client.lookup(plate!);assert.ok(vehicle,'explicitly selected vehicle must exist');assert.equal(vehicle.registrationNumber,normalizeVehicleRegistration(plate!));assert.ok(vehicle.make||vehicle.model||vehicle.nextInspectionDeadline);assert.ok(Number.isFinite(Date.parse(vehicle.fetchedAt)));
});
