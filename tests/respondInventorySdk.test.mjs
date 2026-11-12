import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {createPublicInventoryDb,createCommercialInventoryHandler} from '../lib/respond/inventoryCommercial.mjs';
import {response} from './helpers/socialFixtures.mjs';
import {createInventoryControl} from '../lib/respond/inventoryControl.mjs';
// The SDK transport is intercepted; no hosted database or credentials.
const syntheticToken='synthetic-sdk-fixture-not-a-credential'.padEnd(43,'x');
function cfg(){const n=Date.now();return {VERCEL_ENV:'preview',RESPOND_INVENTORY_ENABLED:'true',RESPOND_INVENTORY_SOURCE:'dev',
  RESPOND_INVENTORY_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co',
  RESPOND_INVENTORY_SUPABASE_PUBLIC_KEY:'sb_publishable_SYNTHETIC_NO_LIVE_KEY',
  RESPOND_INVENTORY_WINDOW_START:new Date(n-1000).toISOString(),RESPOND_INVENTORY_WINDOW_END:new Date(n+3600000).toISOString(),
  RESPOND_INVENTORY_TOKEN_CURRENT_SHA256:createHash('sha256').update(syntheticToken).digest('hex'),
  RESPOND_INVENTORY_TOKEN_CURRENT_FROM:new Date(n-1000).toISOString(),RESPOND_INVENTORY_TOKEN_CURRENT_UNTIL:new Date(n+3600000).toISOString()};}
const request=()=>({method:'GET',url:'/api/respond/inventory?operation=sale&city=Puebla&propertyType=Casa',
  query:{operation:'sale',city:'Puebla',propertyType:'Casa'},headers:{authorization:'Bearer '+syntheticToken}});
function res(){const r=response();r.setHeader=()=>{};return r;}
test('real SDK control transport: POST to sole RPC, no capability returned',async()=>{
 const calls=[],capability='synthetic-control-transport'.padEnd(43,'x'),config=cfg();
 const client=createClient(config.RESPOND_INVENTORY_SUPABASE_URL,config.RESPOND_INVENTORY_SUPABASE_PUBLIC_KEY,{auth:{persistSession:false},global:{fetch:async(url,opts)=>{
  assert.equal(new URL(url).pathname,'/rest/v1/rpc/respond_inventory_gate');assert.equal(opts.method,'POST');
  const args=JSON.parse(opts.body);assert.equal(args.p_capability,capability);calls.push(args.p_action);
  return new Response(JSON.stringify({status:'allowed',generation:3}),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 const control=createInventoryControl({getClient:()=>client,capability:()=>capability});assert.equal(await control.consume(),3);await control.check(3);assert.deepEqual(calls,['consume','check']);
});
test('real Supabase SDK emits only bounded published SELECT; transport hermetically intercepted',async()=>{
  const config=cfg(),calls=[];
  const db=createPublicInventoryDb((u,k,o)=>createClient(u,k,{...o,global:{fetch:async(url,opts)=>{
    calls.push({url:String(url),opts});
    assert.equal(opts.method,'GET');const parsed=new URL(url);
    assert.equal(parsed.origin,config.RESPOND_INVENTORY_SUPABASE_URL);assert.equal(parsed.pathname,'/rest/v1/propiedades');
    assert.equal(parsed.searchParams.get('status'),'eq.published');assert.equal(parsed.searchParams.get('operacion'),'eq.sale');
    assert.equal(parsed.searchParams.get('ciudad'),'ilike.%Puebla%');assert.equal(parsed.searchParams.get('tipo'),'ilike.%Casa%');
    assert.equal(parsed.searchParams.get('limit'),'5');assert(!parsed.searchParams.get('select').includes('*'));
    assert.doesNotMatch(parsed.searchParams.get('select'),/owner|tenant|phone|email|notes/);
    return new Response(JSON.stringify([{id:'SYNTHETIC_PRIVATE_ID',public_id:'SDK-QA',titulo:'Casa SDK QA',
      operacion:'sale',precio:125000.25,moneda:'USD',ciudad:'Puebla',tipo:'Casa',status:'published',recamaras:3,banos:2}]),{status:200,headers:{'Content-Type':'application/json'}});
  }}}),config);
  const h=createCommercialInventoryHandler({sharedControl:{consume:async()=>1,check:async()=>1},getDb:()=>db,env:()=>config}),r=res();await h(request(),r);
  assert.equal(r.statusCode,200);assert.equal(calls.length,1);assert.deepEqual(r.body.results[0].price,{amount:125000.25,currency:'USD'});
  assert.doesNotMatch(JSON.stringify(r.body),/SYNTHETIC_PRIVATE_ID|Bearer|sb_publishable/);
});
test('real SDK error response is sanitized; no returned source body or SQL',async()=>{
  const config=cfg();let calls=0;
  const db=createPublicInventoryDb((u,k,o)=>createClient(u,k,{...o,global:{fetch:async()=>{calls++;return new Response(JSON.stringify({message:'PRIVATE_SQL_FORBIDDEN',code:'42501'}),{status:403,headers:{'Content-Type':'application/json'}});}}}),config);
  const h=createCommercialInventoryHandler({sharedControl:{consume:async()=>1,check:async()=>1},getDb:()=>db,env:()=>config}),r=res();await h(request(),r);
  assert.equal(r.statusCode,503);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_SQL|42501|sb_publishable/);
});
