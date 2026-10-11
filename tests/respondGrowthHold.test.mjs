import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importWithStubs, response } from './helpers/socialFixtures.mjs';
import { RESPOND_COMMERCIAL_HOLD, assertRespondCommercialAvailable, respondFreshness } from '../lib/respondDegradedMode.js';
import { withCommercialExecution, recoverCommercialExecutionOne } from '../lib/social/commercialExecution.js';
import { processCommercialQueueOne, commercialQueueEligible } from '../lib/social/commercialQueue.js';

const forbidden = () => assert.fail('No DB/model/network/effect permitted');
const db = { from: forbidden, rpc: forbidden };
const env = { SOCIAL_ROUTING_V1_ENABLED:'true', SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:'true' };
async function isolated(relative, keep = []) {
  const file = new URL(relative, import.meta.url), source = await readFile(file,'utf8'), stubs = {};
  for (const [,names,path] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    if (path.startsWith('node:') || path.endsWith('respondDegradedMode.js') || keep.includes(path)) continue;
    stubs[path] = Object.fromEntries(names.split(',').map(name => [name.trim(),forbidden]));
  }
  return importWithStubs(file, stubs);
}
test('hold cannot be lifted by stale enable flags',()=>{
  assert.equal(RESPOND_COMMERCIAL_HOLD,true);
  assert.throws(()=>assertRespondCommercialAvailable(env),/respond_commercial_hold/);
});
for(const lane of ['SALES','OWNER','LEGAL']) test(`${lane}: no claim/model/effect, including unmanaged historical input`,async()=>{
  assert.deepEqual(await withCommercialExecution(db,lane,'old',env,forbidden),{status:'disabled',reason:'respond_commercial_hold'});
});
test('pending and retryable jobs remain untouched',async()=>{
  assert.equal((await processCommercialQueueOne(db,{env})).reason,'respond_commercial_hold');
  assert.equal((await recoverCommercialExecutionOne(db,{env})).reason,'respond_commercial_hold');
});
test('durable ingress eligibility preserved, no legacy fallback',()=>{
  assert.equal(commercialQueueEligible({eventType:'message.received',channelId:'498219'}),true);
  assert.equal(commercialQueueEligible({eventType:'message.received',channelId:'544519'}),false);
});
for(const [file,fn] of [['processSalesInbound','processSalesInboundById'],['processOwnerInbound','processOwnerInboundById'],['processLegalInbound','processLegalInboundById']])
  test(`${file}: real entry point cannot enter lane`,async()=>{
    const mod=await isolated(`../lib/agentsV2/${file}.js`,['../social/commercialExecution.js']);
    assert.equal((await mod[fn](db,'historic',{env})).reason,'respond_commercial_hold');
  });
for(const file of ['respond-commercial-worker','owner-agent-v1','legal-agent-v1','sales-agent-v2-auto-shadow','sales-agent-v2-auto-outbound','sales-agent-v2-recovery','sales-v2-handoff-sla','sales-v2-watchdog'])
  test(`${file}: cron authenticates but never touches backlog`,async()=>{
    const mod=await isolated(`../pages/api/cron/${file}.js`);
    const keys=['CRON_SECRET','SALES_AGENT_V2_ENABLED','SALES_AGENT_V2_AUTO_SHADOW_ENABLED','SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED','SALES_AGENT_V2_RECOVERY_ENABLED','SALES_AGENT_V2_HANDOFF_SLA_ENABLED'];
    const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
    try {
      for(const k of keys)process.env[k]=k==='CRON_SECRET'?'fixture-not-secret':'true';
      const denied=response();await mod.default({method:'GET',headers:{}},denied);assert.equal(denied.statusCode,401);
      const res=response();await mod.default({method:'GET',headers:{authorization:'Bearer fixture-not-secret'}},res);
      assert.equal(res.statusCode,200);assert.equal(res.body.status,'disabled');
    } finally { for(const k of keys)before[k]===undefined?delete process.env[k]:process.env[k]=before[k]; }
  });
for(const [file,functions] of [['salesHandoff',['createSalesHandoffIfNeeded','createSalesAutomationFallbackHandoff','processPendingSalesHandoffs','dispatchSalesHandoff','processSalesHandoffSla']],['legalHandoff',['createAndDispatchLegalHandoff']],['salesAutoOutbound',['processSalesAutoOutboundRun','processOneSalesAutoOutbound']]])
  test(`${file}: direct effect callers blocked before storage/network`,async()=>{
    const mod=await isolated(`../lib/agentsV2/${file}.js`);
    for(const fn of functions)await assert.rejects(mod[fn](db,{}, {env}),/respond_commercial_hold/);
  });
test('freshness is historical even when a webhook just arrived; missing date is not current',()=>{
  const rows=[{respond_last_synced_at:'2026-10-11T01:00:00Z'},{respond_last_synced_at:'invalid'},{respond_last_synced_at:'2026-10-11T03:00:00Z'}];
  assert.deepEqual(respondFreshness(rows),{realtime:false,notice:'Datos de Respond sin sincronización en tiempo real',lastUpdatedAt:'2026-10-11T03:00:00Z'});
  assert.equal(respondFreshness().lastUpdatedAt,null);
});
test('work center omits snapshots from live metrics and exposes unavailable, not zero',async()=>{
  const source=await readFile(new URL('../pages/api/ejecutivo/work-center.js',import.meta.url),'utf8');
  assert.match(source,/RESPOND_COMMERCIAL_HOLD \|\| snapshotsMissing \? \[\]/);
  assert.match(source,/summary.openConversations = null/);
  assert.match(source,/summary.waitingResponses = null/);
  assert.match(source,/respondFreshness: frozenRespond/);
});
test('all snapshot views carry historical notice and last update; no current owner claim',async()=>{
  for(const path of ['components/ejecutivo/WorkCenterView.js','pages/ventas-ia-sombra.js','pages/social-routing.js']){
    const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
    assert.match(source,/<RespondFreshnessNotice lastUpdatedAt=/);
  }
  const source=await readFile(new URL('../pages/api/operaciones/sales-v2-shadow-view.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Responsable actual en Respond/);
});
