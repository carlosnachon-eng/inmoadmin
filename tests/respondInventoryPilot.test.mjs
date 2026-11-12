import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInventoryPilotHandler } from '../lib/respond/inventoryPilot.mjs';
import { memoryDb, response } from './helpers/socialFixtures.mjs';
import { RESPOND_COMMERCIAL_HOLD } from '../lib/respondDegradedMode.js';

const token = 'synthetic-not-a-credential-'.padEnd(43, 'x');
const at = Date.parse('2026-10-30T16:00:00Z');
const config = () => ({ VERCEL_ENV: 'development', SUPABASE_ENVIRONMENT: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://hjfwjnejbcpmknvfpdcq.supabase.co',
  RESPOND_INVENTORY_PILOT_ENABLED: 'true',
  RESPOND_INVENTORY_PILOT_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
  RESPOND_INVENTORY_PILOT_EXPIRES_AT: new Date(at + 3600000).toISOString() });
const path = '/api/dev/respond-inventory-pilot';
const params = 'operation=rental&city=Puebla&propertyType=Casa';
const request = (query = params) => ({ method: 'GET', url: path + (query ? '?' + query : ''),
  headers: { authorization: 'Bearer ' + token }, query: Object.fromEntries(new URLSearchParams(query)) });
const listing = (overrides = {}) => ({ id: 'internal-id-not-public', public_id: 'QA-PUBLIC', titulo: 'Casa sintética',
  ciudad: 'Puebla', tipo: 'Casa', operacion: 'rental', status: 'published', precio: '11000', moneda: 'MXN',
  recamaras: 2, banos: 1, updated_at: '2026-10-30', owner_email: 'private@example.invalid', ...overrides });
function fixture({ rows = [listing()], cfg = config(), result, wait, deadlineMs = 4000, observe } = {}) {
  const memory = memoryDb({ propiedades: rows }), steps = [], signals = [];
  let factories = 0, reads = 0;
  const db = { from(table) {
    steps.push(['from', table]);
    const q = memory.from(table);
    const wrap = new Proxy({}, { get(_t, name) {
      if (name === 'abortSignal') return signal => { signals.push(signal); return wrap; };
      if (name === 'then') return (yes, no) => {
        reads++;
        if (wait) return wait(signals.at(-1)).then(yes, no);
        if (result) return Promise.resolve(result).then(yes, no);
        return q.then(yes, no);
      };
      return (...args) => { steps.push([name, ...args]); q[name](...args); return wrap; };
    }});
    return wrap;
  }};
  const handler = createInventoryPilotHandler({ getDb: () => { factories++; return db; }, env: () => cfg,
    now: () => at, deadlineMs, observe });
  const invoke = async (req = request()) => {
    const res = response(); res.headers = {}; res.setHeader = (k, v) => { res.headers[k] = v; };
    await handler(req, res); return res;
  };
  return { invoke, handler, cfg, memory, steps, signals, get factories() { return factories; }, get reads() { return reads; } };
}

test('real search: published + all filters, bounded latest rows, DTO strips internal/private fields', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => listing({ id: 'internal-' + i, public_id: 'QA-' + i, updated_at: '2026-10-' + (10+i) }));
  rows.push(listing({ status: 'reserved' }), listing({ status: 'archived' }), listing({ status: 'leased' }),
    listing({ ciudad: 'Veracruz' }), listing({ tipo: 'Bodega' }), listing({ operacion: 'sale' }));
  const f = fixture({ rows }), r = await f.invoke();
  assert.equal(r.statusCode, 200); assert.equal(r.body.status, 'matched');
  assert.deepEqual(r.body.results.map(x => x.public_code), ['QA-5', 'QA-4', 'QA-3']);
  assert.equal(r.body.returned_count, 3); assert.equal(r.body.exhaustive, false);
  assert.equal(f.reads, 1); assert.deepEqual(f.steps.filter(s => s[0] === 'eq'), [['eq','status','published'],['eq','operacion','rental']]);
  assert.deepEqual(f.steps.filter(s => s[0] === 'ilike'), [['ilike','ciudad','%Puebla%'],['ilike','tipo','%Casa%']]);
  assert.ok(f.steps.some(s => s[0] === 'limit' && s[1] === 5));
  assert.ok(f.signals[0] instanceof AbortSignal);
  assert.ok(f.memory.operations.every(x => x.op === 'select' && x.table === 'propiedades'));
  assert.doesNotMatch(JSON.stringify(r.body), /internal-|private@|owner|tenant|phone|contract|availableFrom/);
  assert.ok(r.body.results.every(x => x.availability === 'not_confirmed'));
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  assert.equal(RESPOND_COMMERCIAL_HOLD, true);
});
test('empty is successful bounded query; missing inputs never open DB', async () => {
  const f = fixture({ rows: [] }); assert.equal((await f.invoke()).body.status, 'empty');
  const g = fixture(), r = await g.invoke(request('operation=rental'));
  assert.equal(r.body.status, 'needs_clarification'); assert.deepEqual(r.body.missing_fields, ['city','propertyType']);
  assert.equal(g.factories, 0); assert.equal(r.body.queried_at, undefined);
});
test('queries are fresh, preserve source currency/null and never imply bank/availability facts', async () => {
  const f = fixture(); await f.invoke(); f.memory.tables.propiedades[0].precio = '2000'; f.memory.tables.propiedades[0].moneda = 'USD';
  assert.deepEqual((await f.invoke()).body.results[0].price, { amount: 2000, currency: 'USD' });
  f.memory.tables.propiedades[0].precio = null; f.memory.tables.propiedades[0].moneda = null;
  assert.deepEqual((await f.invoke()).body.results[0].price, { amount: null, currency: null });
  f.memory.tables.propiedades[0].status = 'reserved'; assert.equal((await f.invoke()).body.status, 'empty');
});
test('production, mismatched DB, conflicting app env and absent enable flag fail before DB', async () => {
  for (const change of [{VERCEL_ENV:'production'},{SUPABASE_ENVIRONMENT:'production'},
    {NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co'},
    {NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co.evil.invalid'},
    {RESPOND_INVENTORY_PILOT_ENABLED:undefined},{VERCEL_ENV:undefined}]) {
    const f = fixture({cfg:{...config(),...change}}); assert.equal((await f.invoke()).statusCode,404); assert.equal(f.factories,0);
  }
});
test('missing/wrong/expired/malformed authentication never opens DB or echoes secrets', async () => {
  for (const header of [undefined, 'Bearer ' + 'a'.repeat(43), 'Basic ' + token, ['Bearer ' + token], 'Bearer short']) {
    const f=fixture(), r=await f.invoke({...request(),headers:{authorization:header}});
    assert.equal(r.statusCode,401); assert.equal(f.factories,0); assert.ok(!JSON.stringify(r.body).includes(token));
  }
  for (const expiry of [new Date(at).toISOString(), 'not-a-date',new Date(at+86400001).toISOString()]) {
    const f=fixture({cfg:{...config(),RESPOND_INVENTORY_PILOT_EXPIRES_AT:expiry}});
    assert.equal((await f.invoke()).statusCode,401); assert.equal(f.factories,0);
  }
});
test('non-GET rejects even with authorized token; no body parser or mutation route', async () => {
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']) {
    const f=fixture(), r=await f.invoke({...request(),method}); assert.equal(r.statusCode,405); assert.equal(f.factories,0);
  }
});
test('strict URL and Next query validation rejects injection, duplicates, budget, IDs and arrays', async () => {
  for(const query of [params+'&maxPrice=100',params+'&propertyId=foreign',params+'&city=Veracruz',
    'operation=sale&city=Puebla%25&propertyType=Casa','operation=sale&city=Puebla%2Cor%28true%29&propertyType=Casa',
    'operation=SALE&city=Puebla&propertyType=Casa','operation=sale&city=Puebla&propertyType=%25',
    params+'&select=*',params+'&city[]=Puebla','operation=&city=Puebla&propertyType=Casa',
    'operation=sale&city='+ 'a'.repeat(81)+'&propertyType=Casa']) {
    const f=fixture(); assert.equal((await f.invoke(request(query))).statusCode,400,query); assert.equal(f.factories,0);
  }
  const f=fixture(); assert.equal((await f.invoke({...request(),query:{city:['Puebla']}})).statusCode,400); assert.equal(f.factories,0);
});
test('upstream error, nonarray and invalid source rows fail closed without SQL/stack leakage', async () => {
  for(const result of [{data:null,error:{message:'SECRET_SQL'}},{data:{},error:null},
    {data:[listing({status:'reserved'})],error:null}, {data:[listing({operacion:'sale'})],error:null}]) {
    const f=fixture({result}), r=await f.invoke(); assert.equal(r.statusCode,503);
    assert.equal(r.body.status,'error'); assert.doesNotMatch(JSON.stringify(r.body),/SECRET_SQL|stack|reserved/);
  }
  for(const changed of [{precio:'NaN'},{precio:-1},{moneda:'secret'},{titulo:'Escribe private@example.invalid'},
    {titulo:'Llama 5551234567'},{public_id:'../../private'},{titulo:'x'.repeat(121)}]) {
    assert.equal((await fixture({rows:[listing(changed)]}).invoke()).statusCode,503);
  }
});
test('cancels actual source signal on timeout; no retry; concurrent calls rejected', async () => {
  let starts=0;
  const f=fixture({deadlineMs:20,wait:signal=>new Promise((_ok,reject)=>{
    starts++;signal.addEventListener('abort',()=>reject(Error('SECRET_ABORT_DETAIL')),{once:true});
  })});
  const pending=f.invoke(); await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal((await f.invoke()).statusCode,429);
  const r=await pending; assert.equal(r.statusCode,504); assert.equal(r.body.code,'source_timeout');
  assert.equal(f.signals[0].aborted,true); assert.equal(starts,1);
});
test('a source ignoring abort keeps concurrency slot closed instead of piling up work', async () => {
  let settle; const f=fixture({deadlineMs:10,wait:()=>new Promise(resolve=>{settle=resolve;})});
  assert.equal((await f.invoke()).statusCode,504); assert.equal((await f.invoke()).statusCode,429);
  settle({data:[],error:null}); await new Promise(resolve=>setImmediate(resolve));
});
test('per-process rate cap enforces ten authenticated requests per minute', async () => {
  const f=fixture();for(let i=0;i<10;i++)assert.equal((await f.invoke()).statusCode,200);
  const r=await f.invoke(); assert.equal(r.statusCode,429);assert.equal(f.reads,10);assert.equal(r.headers['Retry-After'],'60');
});
test('local handler latency budget, bounded UTF8 response and metadata-only telemetry', async () => {
  const durations=[];
  for(let i=0;i<20;i++) {
    const observations=[], f=fixture({observe:x=>observations.push(x)}), start=performance.now(), r=await f.invoke();
    durations.push(performance.now()-start); assert.equal(r.statusCode,200);
    assert.ok(Buffer.byteLength(JSON.stringify(r.body),'utf8')<=8192);
    assert.deepEqual(Object.keys(observations[0]).sort(),['duration_ms','request_id','timed_out']);
  }
  durations.sort((a,b)=>a-b); assert.ok(durations[18]<3000); assert.ok(durations[19]<5000);
  console.log(JSON.stringify({scope:'local_in_memory_not_network_or_Supabase',samples:20,p95_ms:durations[18],max_ms:durations[19]}));
});
test('loopback HTTP: status, headers, encoded filters, auth rejection and clarification', async () => {
  const { createServer } = await import('node:http');
  const f = fixture();
  const server = createServer((req, res) => {
    req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => res.end(JSON.stringify(body));
    f.handler(req, res).catch(() => { res.statusCode = 500; res.end('{}'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const denied = await fetch(origin + path + '?' + params);
    assert.equal(denied.status, 401); assert.equal(f.factories, 0);
    const matched = await fetch(origin + path + '?' + params, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(matched.status, 200); assert.match(matched.headers.get('content-type'), /application\/json/);
    assert.equal(matched.headers.get('access-control-allow-origin'), null);
    assert.equal((await matched.json()).results[0].availability, 'not_confirmed');
    const clarification = await fetch(origin + path, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal((await clarification.json()).status, 'needs_clarification'); assert.equal(f.reads, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('preview still requires DEV project, expired or malformed hash is denied, accented city works', async () => {
  const f=fixture({cfg:{...config(),VERCEL_ENV:'preview'},rows:[listing({ciudad:'Córdoba'})]});
  assert.equal((await f.invoke(request('operation=rental&city=C%C3%B3rdoba&propertyType=Casa'))).body.status,'matched');
  const bad=fixture({cfg:{...config(),RESPOND_INVENTORY_PILOT_TOKEN_SHA256:'invalid'}});
  assert.equal((await bad.invoke()).statusCode,401);assert.equal(bad.factories,0);
});
test('invalid fifth row is rejected before truncation, telemetry exceptions cannot expose errors', async () => {
  const rows=Array.from({length:5},(_,i)=>listing({public_id:'QA-'+i,updated_at:'2026-10-'+(10+i),
    titulo:i===0?'private@example.invalid':'Casa de prueba'}));
  const f=fixture({rows,observe:()=>{throw Error('SECRET_OBSERVER');}}),r=await f.invoke();
  assert.equal(r.statusCode,503);assert.equal(r.body.code,'source_data_invalid');
  assert.doesNotMatch(JSON.stringify(r.body),/private@|SECRET_OBSERVER/);
});
