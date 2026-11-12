import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryControl} from '../lib/respond/inventoryControl.mjs';
const secret='synthetic-control-capability'.padEnd(43,'x');
function fixture(reply){let calls=0;const c=createInventoryControl({capability:()=>secret,timeoutMs:10,getClient:()=>({rpc(name,args){calls++;assert.equal(name,'respond_inventory_gate');assert.equal(args.p_capability,secret);return{abortSignal:signal=>reply(signal,args)};}})});return{c,get calls(){return calls;}};}
test('central admission/check validate generation without caching',async()=>{const f=fixture(async(_s,a)=>({data:{status:'allowed',generation:4}}));assert.equal(await f.c.consume(),4);await f.c.check(4);assert.equal(f.calls,2);});
for(const [label,reply] of [
 ['provider error',async()=>({error:{message:'PRIVATE_SQL'},data:null})],
 ['malformed',async()=>({data:{status:'allowed'}})],
 ['invalid generation',async()=>({data:{status:'allowed',generation:'1'}})],
 ['unknown status',async()=>({data:{status:'unknown',generation:1}})],
 ['network failure',async()=>{throw Error('PRIVATE_NETWORK');}],
 ['never resolves',()=>new Promise(()=>{})],
])test('fails closed: '+label,async()=>{await assert.rejects(fixture(reply).c.consume(),e=>e.message==='control_unavailable');});
test('disabled and rate-limited states remain denials',async()=>{for(const [status,code] of [['disabled','control_disabled'],['limited','control_rate_limited']])await assert.rejects(fixture(async()=>({data:{status}})).c.consume(),e=>e.message===code);});
test('mismatched response generation denied',async()=>{await assert.rejects(fixture(async()=>({data:{status:'allowed',generation:2}})).c.check(1),/control_unavailable/);});
test('missing capability never constructs client',async()=>{let calls=0;const c=createInventoryControl({getClient:()=>{calls++;},capability:()=>undefined});await assert.rejects(c.consume(),/control_unavailable/);assert.equal(calls,0);});
