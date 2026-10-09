import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { shadowOnceGate, restrictedAdminRequest, runMetaAdminShadowOnce, proposeOpenAIOnce } from '../lib/messaging/metaAdminCapture/shadowOnce.js';
import { readFileSync } from 'node:fs';

const env = { OPENAI_ADMIN_AGENT_MODEL: 'gpt-6-luna', OPENAI_API_KEY: 'synthetic-never-used' };
const id = randomUUID(), stamp = Date.now();
const iso = ms => new Date(ms).toISOString();
const beforeFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail('External network forbidden');
after(() => { globalThis.fetch = beforeFetch; });
function snapshot() {
  return { input: { id, waba_id:'1297760461811288', phone_number_id:'1198305790026665',
    capture_reason:'captured', message_type:'text', sanitized_text:'Hola, necesito orientación.',
    native_message_id:'wamid.SYNTHETIC', occurred_at:iso(stamp-900000),captured_at:iso(stamp-899000), observer_only:true, observer_state:'observed' },
    enabled:true, scope_channel:'544519', mutated:false, later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,
    checked_at:iso(stamp),latest_received_at:iso(stamp-899000),transport_health:{status:'healthy',checked_at:iso(stamp),
      waba_id:'1297760461811288',phone_number_id:'1198305790026665',receiver_ready:true,subscription_active:true,
      coverage_complete:true,known_pending:0,in_flight:0,unresolved_failures:0,
      covered_from:iso(stamp-900000),covered_through:iso(stamp),evidence_refs:['synthetic-intercepted-evidence']},
    identity:{state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false} };
}
function harness({change=()=>{},propose}={}) {
  let record=null,calls=0,reads=0,claims=0;
  const store={async snapshot(){const s=snapshot();change(s,++reads);return s;},
    async claim(a){claims++;if(record)return false;record={...a,status:'claimed'};return true;},
    async start(a){if(record.token!==a.token||record.status!=='claimed')return false;record.status='model_started';return true;},
    async startAdminModel(){return true;},
    async finish(a){assert.equal(a.token,record.token);record={...record,...a};}};
  const run=()=>runMetaAdminShadowOnce({inputId:id,authorizedInputId:id,store,env,now:()=>stamp,
    propose:async context=>{calls++;assert.deepEqual(Object.keys(context).sort(),['identity_state','mode','sanitized_text']);
      return propose?propose(context):{provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'resp_synthetic',proposed_response:'¿En qué puedo orientarte?'};}});
  return {run,store,get record(){return record;},get calls(){return calls;},get claims(){return claims;}};
}
test('unmatched is accepted without fabricated identity or private context',()=>{
  const s=snapshot();s.input.client_identity_id=randomUUID();s.input.contract='DO NOT USE';
  const g=shadowOnceGate(s,stamp);assert.equal(g.allowed,true);
  assert.deepEqual(g.context,{identity_state:'unmatched',mode:'anonymous_restricted',sanitized_text:s.input.sanitized_text});
  const body=restrictedAdminRequest(g.context,env);
  assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');assert.equal(body.store,false);
  assert.equal(body.input.includes('DO NOT USE'),false);assert.equal(body.input.includes('client_identity_id'),false);
});
test('matched requires exact bridge and also gets no private tools',()=>{
  const s=snapshot();s.identity={state:'matched',reason:'exact_existing_canonical_phone',candidate_count:1,
    client_identity_id:randomUUID(),authorizes_business:false};
  const g=shadowOnceGate(s,stamp);assert.equal(g.allowed,true);assert.equal(g.context.identity_state,'matched');
  assert.equal(JSON.stringify(g.context).includes(s.identity.client_identity_id),false);
  assert.deepEqual(restrictedAdminRequest(g.context,env).tools,[]);
});
for(const [name,mutate] of [
  ['temporal identity',s=>{s.identity={state:'matched',reason:'temporal',candidate_count:1,client_identity_id:randomUUID(),authorizes_business:false};}],
  ['ambiguous identity',s=>{s.identity.state='ambiguous';}],
  ['invalid unmatched',s=>{s.identity.client_identity_id=randomUUID();}],
  ['later app echo (real-case equivalent)',s=>{s.later_scope_echoes=4;}],
  ['unknown echo coverage',s=>{delete s.later_scope_echoes;}],
  ['scope',s=>{s.input.phone_number_id='other';}],
  ['mutated',s=>{s.mutated=true;}],
  ['stale query',s=>{s.checked_at=iso(stamp-6000);}],
  ['uncertain event',s=>{s.later_scope_uncertain=1;}],
  ['unsanitized text',s=>{s.input.sanitized_text='llama al 2221234567';}],
]) test(`${name} blocks before claim/model`,async()=>{
  const h=harness({change:mutate});const r=await h.run();assert.equal(r.status,'blocked');assert.equal(h.calls,0);assert.equal(h.claims,0);
});
test('repeats gates after exclusive claim immediately before model',async()=>{
  const h=harness({change:(s,n)=>{if(n===2)s.later_scope_echoes=1;}});
  assert.equal((await h.run()).status,'blocked');assert.equal(h.calls,0);assert.equal(h.record.status,'blocked');
});
test('manual reservation blocks shadow before model without resume',async()=>{
  const h=harness({change:s=>{s.manual_attention=true;}});
  assert.equal((await h.run()).reason,'human_manual_reply');assert.equal(h.calls,0);assert.equal(h.claims,0);
});
test('durable manual pause during model invalidates proposal at post-gate',async()=>{
  let paused=false;
  const h=harness({change:s=>{s.manual_attention=paused;},propose:async()=>{
    paused=true;return {provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'fixture',proposed_response:'Propuesta interceptada.'};
  }});
  const r=await h.run();assert.equal(r.status,'invalidated');assert.equal(r.reason,'human_manual_reply');assert.equal(h.calls,1);assert.equal(r.send_calls,0);
});
test('quiet 15-minute inbound needs fresh DB snapshot, not transport grant',async()=>{
  const h=harness();assert.equal((await h.run()).status,'complete');assert.equal(h.calls,1);
  const s=snapshot();delete s.latest_received_at;
  assert.equal(shadowOnceGate(s,stamp).allowed,true);
  s.transport_health.coverage_complete=false;
  assert.equal(shadowOnceGate(s,stamp).allowed,true);
});
test('DB snapshot stale after durable start prevents request without resetting attempt',async()=>{
  const h=harness({change:(s,n)=>{if(n===3)s.checked_at=iso(stamp-5001);}});
  assert.equal((await h.run()).status,'blocked');assert.equal(h.calls,0);
  assert.equal(h.record.status,'uncertain');assert.equal((await h.run()).status,'already_claimed');
});
test('transport diagnostic loss after model does not invalidate intercepted proposal',async()=>{
  const h=harness({change:(s,n)=>{if(n===4)s.transport_health.coverage_complete=false;}});
  const r=await h.run();assert.equal(r.status,'complete');assert.equal(h.calls,1);assert.equal(r.send_calls,0);
});
for (const health of [undefined,null,{status:'unknown'},{status:'unhealthy'},
  {status:'healthy',checked_at:iso(stamp-900000)},
  {status:'unknown',known_pending:1,in_flight:1,unresolved_failures:1}]) {
  test(`transport diagnostic ${JSON.stringify(health)} is not a shadow grant`,async()=>{
    const h=harness({change:s=>{s.transport_health=health;}});
    const r=await h.run();assert.equal(r.status,'complete');assert.equal(h.calls,1);assert.equal(r.send_calls,0);
  });
}
test('only individually proven other_subject echoes are excluded',async()=>{
  const h=harness({change:s=>{s.later_scope_echoes=1;s.echo_assessments=[{event_id:'synthetic',state:'other_subject'}];}});
  assert.equal((await h.run()).status,'complete');assert.equal(h.calls,1);
  for(const state of ['same_subject','unknown','conflict','invalid']){
    const blocked=harness({change:s=>{s.later_scope_echoes=1;s.echo_assessments=[{event_id:'synthetic',state}];}});
    assert.equal((await blocked.run()).status,'blocked');assert.equal(blocked.calls,0);
  }
});
test('same_subject arriving after claim or during model is rechecked',async()=>{
  for(const phase of [2,4]){
    const h=harness({change:(s,n)=>{if(n===phase){s.later_scope_echoes=1;s.echo_assessments=[{event_id:'synthetic',state:'same_subject'}];}}});
    assert.equal((await h.run()).status,phase===2?'blocked':'invalidated');assert.equal(h.calls,phase===2?0:1);
  }
});
test('human/uncertain evidence during model invalidates retained proposal; never sends',async()=>{
  const h=harness({change:(s,n)=>{if(n===4)s.later_scope_echoes=1;}});
  const r=await h.run();assert.equal(r.status,'invalidated');assert.equal(r.proposal_valid,false);
  assert.equal(r.send_calls,0);assert.equal(h.calls,1);assert.ok(h.record.proposed_response);
});
test('concurrency and duplicate calls consume only one irreversible attempt',async()=>{
  const h=harness();const r=await Promise.all([h.run(),h.run()]);
  assert.deepEqual(r.map(x=>x.status).sort(),['already_claimed','complete']);assert.equal(h.calls,1);
  assert.equal((await h.run()).status,'already_claimed');assert.equal(h.calls,1);
});
test('uncertain model outcome is terminal; no retry',async()=>{
  const h=harness({propose:()=>{throw Error('timeout');}});assert.equal((await h.run()).status,'uncertain');
  assert.equal(h.calls,1);assert.equal((await h.run()).status,'already_claimed');assert.equal(h.calls,1);
});
test('provider mismatch blocks before snapshot and never falls back',async()=>{
  for(const e of [{...env,OPENAI_ADMIN_AGENT_MODEL:'claude-haiku'}, {...env,META_ADMIN_SHADOW_MODEL_PROVIDER:'anthropic'}]) {
    await assert.rejects(runMetaAdminShadowOnce({inputId:id,authorizedInputId:id,env:e,
      store:{snapshot(){assert.fail('must not query');}}}),/openai_only_no_fallback/);
  }
});
test('only the one explicitly authorized input',async()=>{
  await assert.rejects(runMetaAdminShadowOnce({inputId:id,authorizedInputId:randomUUID(),env}),/one_input_authorization_required/);
});
test('OpenAI request exactly once; no tools, private data, fallback or retry',async()=>{
  let requests=0;
  const result=await proposeOpenAIOnce(shadowOnceGate(snapshot(),stamp).context,{env,fetchImpl:async(url,args)=>{
    requests++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(args.redirect,'error');
    const b=JSON.parse(args.body);assert.equal(b.model,env.OPENAI_ADMIN_AGENT_MODEL);assert.deepEqual(b.tools,[]);
    assert.equal(b.tool_choice,'none');assert.equal(b.store,false);
    return{ok:true,json:async()=>({id:'resp_synthetic',status:'completed',model:b.model,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Hola. ¿En qué puedo orientarte?'}]}]})};
  }});
  assert.equal(requests,1);assert.equal(result.provider,'openai');assert.ok(result.proposed_response);
});
test('tool request or failure cannot execute tools or produce another generation',async()=>{
  for(const output of [[{type:'function_call',name:'get_payment_summary'}],[]]){
    let requests=0;await assert.rejects(proposeOpenAIOnce(shadowOnceGate(snapshot(),stamp).context,{env,
      fetchImpl:async()=>{requests++;return{ok:true,json:async()=>({status:'completed',id:'x',model:env.OPENAI_ADMIN_AGENT_MODEL,output})};}}),/model_result_uncertain/);
    assert.equal(requests,1);
  }
});
test('source boundaries: no sender, Respond loader, #174, existing preflight or model import in SQL adapter',()=>{
  const source=readFileSync(new URL('../lib/messaging/metaAdminCapture/shadowOncePostgres.js',import.meta.url),'utf8');
  for(const forbidden of ['gv_respond','shadow_messages','messaging_correlation','prepare_meta_admin_shadow_v1','sendText','fetch(','OPENAI_API_KEY'])
    assert.equal(source.includes(forbidden),false);
});
