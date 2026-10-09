import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetaAdminTransportReader } from '../lib/messaging/metaAdminCapture/transportHealth.js';
import { createShadowOncePostgresStore } from '../lib/messaging/metaAdminCapture/shadowOncePostgres.js';
const stamp = Date.parse('2026-10-09T00:00:00Z'), iso = n => new Date(n).toISOString();
const candidate = () => ({waba_id:'1297760461811288',phone_number_id:'1198305790026665',
  occurred_at:iso(stamp-900000),captured_at:iso(stamp-899000),checked_at:iso(stamp),persisted:true,unresolved_ingestion:0});
function harness({rows=[],apps,deploy={},failure=false,more=false,advance=0}={}) {
  let calls=0;
  const reader=createMetaAdminTransportReader({projectId:'project',teamId:'team',hostname:'example.invalid',
    expectedDeploymentId:'deployment',expectedSha:'a'.repeat(40),vercelToken:'fake-vercel',metaToken:'fake-meta',
    now:()=>stamp+(calls>0?advance:0),fetchImpl:async(url,options)=>{
      calls++; assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
      assert.ok(!String(url).includes('fake-')); if(failure)throw Error('secret must not escape');
      const data=String(url).includes('subscribed_apps') ? (apps??{data:[{whatsapp_business_api_data:{id:'1728488815945294'}}]})
        : String(url).includes('request-logs') ? {rows,hasMoreRows:more}
        : {id:'deployment',projectId:'project',target:'production',readyState:'READY',meta:{githubCommitSha:'a'.repeat(40)},ready:stamp-1000000,...deploy};
      return {ok:true,json:async()=>data};
    }});
  return reader;
}
const row = (changes={}) => ({requestId:'request',timestamp:iso(stamp-5000),requestPath:'/api/webhooks/meta',
  requestMethod:'POST',environment:'production',deploymentId:'deployment',statusCode:200,logs:[],...changes});
test('15-minute inbound, healthy interval with no additional traffic',async()=>{
  const result=await harness()(candidate()); assert.equal(result.status,'healthy');
  assert.equal(result.basis,'observable_operational_evidence_only'); assert.equal(result.covered_through,iso(stamp));
});
for(const [name,options,status] of [
  ['5xx',{rows:[row({statusCode:503})]},'unhealthy'],
  ['timeout',{rows:[row({logs:[{level:'error',message:'timeout'}]})]},'unhealthy'],
  ['in flight',{rows:[row({statusCode:null})]},'unknown'],
  ['unexpected SHA',{deploy:{meta:{githubCommitSha:'b'.repeat(40)}}},'unknown'],
  ['subscription missing',{apps:{data:[]}},'unknown'],
  ['read error',{failure:true},'unknown'],
  ['truncated log',{rows:[row({logs:[{level:'info',message:'partial',messageTruncated:true}]})]},'unknown'],
  ['contradictory results',{rows:[row(),row({statusCode:503})]},'unknown'],
  ['incomplete pagination',{more:true},'unknown'],
  ['slow reader',{advance:5001},'unknown'],
]) test(name,async()=>assert.equal((await harness(options)(candidate())).status,status));
test('stale snapshot blocks',async()=>assert.equal((await harness()({...candidate(),checked_at:iso(stamp-5001)})).status,'unknown'));
test('unresolved ingestion unhealthy',async()=>assert.equal((await harness()({...candidate(),unresolved_ingestion:1})).status,'unhealthy'));
test('candidate not durable unknown',async()=>assert.equal((await harness()({...candidate(),persisted:false})).status,'unknown'));
test('store passes only narrow metadata and refreshes journals after health',async()=>{
  let reads=0;
  const store=createShadowOncePostgresStore({query:async()=>({rows:[{snapshot:{input:{...candidate(),observer_only:true,observer_state:'observed',sanitized_text:'PRIVATE'},
    checked_at:iso(stamp),later_scope_uncertain:0,subject_nodes:[],echo_roots:[],mutated:++reads===2}}]})},
    {readTransportHealth:async(c)=>{assert.equal(c.sanitized_text,undefined);assert.equal(c.persisted,true);return {status:'healthy'};}});
  const s=await store.snapshot('synthetic'); assert.equal(reads,2);assert.equal(s.mutated,true);
});
test('store health read error fails closed without exposing error',async()=>{
  const store=createShadowOncePostgresStore({query:async()=>({rows:[{snapshot:{input:{},subject_nodes:[],echo_roots:[]}}]})},
    {readTransportHealth:async()=>{throw Error('SECRET');}});
  const s=await store.snapshot('synthetic'); assert.deepEqual(s.transport_health,{status:'unknown'});
});
