import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runMetaAdminShadowOnce} from '../../lib/messaging/metaAdminCapture/shadowOnce.js';
import {createShadowOnceSupabaseStore} from '../../lib/messaging/metaAdminCapture/shadowOnceSupabase.js';
import {createShadowMediaReader} from '../../lib/messaging/metaAdminCapture/shadowMedia.js';
import {interpretOpenAIShadowMedia} from '../../lib/shadow/media/openaiInterpretation.js';

// Local PostgreSQL harness only: HTTP/OpenAI calls intercepted, never real.
export async function certifyModelAccounting({root,service,connection,receive,fresh,one,scenario}){
 const env={OPENAI_ADMIN_AGENT_MODEL:'gpt-4.1-mini',OPENAI_API_KEY:'synthetic-never-network'};
 const rpc=c=>({async rpc(name,args){assert.match(name,/^meta_admin_[a-z_]+_v1$/);const keys=Object.keys(args);
  return {data:(await c.query('select public.'+name+'('+keys.map((k,i)=>k+'=>$'+(i+1)).join(',')+') x',Object.values(args))).rows[0].x};}});
 const db=rpc(service),store=createShadowOnceSupabaseStore(db);
 const insert=async(text=false)=>{const body=fresh(text?{}:{type:'image',text:undefined,image:{id:'900000000000009'}});assert.equal((await receive(body)).statusCode,200);return(await one(body)).id;};
 const counts=async id=>(await root.query('select status,model_calls,media_model_calls,send_calls from meta_admin_private.shadow_once_runs where input_id=$1',[id])).rows[0];
 for(const [mode,adminExpected,mediaExpected] of [['retrieval_failure',0,0],['interpretation_failure',0,1],['post_media_gate',0,1],['complete_media',1,1],['text',1,0]])
  await scenario('durable counters: '+mode,async()=>{
   const id=await insert(mode==='text');let adminCalls=0,mediaCalls=0,mutated=false;
   const scopedStore={...store,snapshot:async input=>{const s=await store.snapshot(input);if(mutated)s.mutated=true;return s;}};
   const readMedia=createShadowMediaReader({db,env,
    retrieve:async()=>{if(mode==='retrieval_failure')throw Error('synthetic retrieval');return {buffer:Buffer.from('89504e470d0a1a0a','hex'),validated:{validatedMime:'image/png'}};},
    interpret:(media,options)=>interpretOpenAIShadowMedia(media,{...options,fetchImpl:async()=>{
     mediaCalls++;if(mode==='interpretation_failure')throw Error('synthetic OpenAI uncertainty');
     if(mode==='post_media_gate')mutated=true;
     return {ok:true,json:async()=>({status:'completed',model:env.OPENAI_ADMIN_AGENT_MODEL,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({media_type:'image',interpretation_status:'completed',category:'other_image',summary:'Contenido observado de prueba.',extracted_fields:{amount:null,currency:null,date:null,sender_bank:null,recipient_bank:null,reference:null,account_last4:null,observable_issues:[]},confidence:0.8,requires_human_review:true,review_reason:null})}]}]})};
    }})});
   const execute=()=>runMetaAdminShadowOnce({inputId:id,authorizedInputId:id,store:scopedStore,env,readMedia,propose:async()=>{
    adminCalls++;return {provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'mock',proposed_response:'Propuesta interceptada.'};}});
   const result=await execute();assert.equal(result.model_calls,adminExpected);assert.equal(result.media_model_calls??0,mediaExpected);
   if(mode==='text')assert.equal(Object.hasOwn(result,'media_model_calls'),false);
   assert.equal(adminCalls,adminExpected);assert.equal(mediaCalls,mediaExpected);
   const row=await counts(id);assert.equal(row.model_calls,adminExpected);assert.equal(row.media_model_calls,mediaExpected);assert.equal(row.send_calls,0);
   assert.equal(row.status,adminExpected?'complete':'uncertain');
   mutated=false;assert.equal((await execute()).status,'already_claimed');assert.equal(adminCalls,adminExpected);assert.equal(mediaCalls,mediaExpected);
  });
 await scenario('start reserves 0/0; Admin CAS concurrent one winner; no reset/replay',async()=>{
  const id=await insert(true),token=randomUUID();
  assert.equal(await store.claim({inputId:id,token,fingerprint:'a'.repeat(64),identityState:'matched',provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL}),true);
  assert.equal(await store.startAdminModel({inputId:id,token}),false);
  assert.equal(await store.start({inputId:id,token}),true);assert.equal((await counts(id)).model_calls,0);
  assert.equal(await store.startAdminModel({inputId:id,token:randomUUID()}),false);
  const other=createShadowOnceSupabaseStore(rpc(await connection('service_role')));
  const won=await Promise.all([store,other].map(s=>s.startAdminModel({inputId:id,token})));assert.deepEqual(won.sort(),[false,true]);
  await store.finish({inputId:id,token,status:'uncertain',reason:'test'});
  assert.equal(await store.start({inputId:id,token}),false);assert.equal(await store.startAdminModel({inputId:id,token}),false);
 });
 await scenario('media CAS concurrent one winner; terminal with Admin zero; ACL restricted',async()=>{
  const id=await insert(),token=randomUUID();await store.claim({inputId:id,token,fingerprint:'a'.repeat(64),identityState:'matched',provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL});await store.start({inputId:id,token});
  await db.rpc('meta_admin_shadow_media_claim_v1',{p_input_id:id,p_token:token});
  assert.equal(await store.startAdminModel({inputId:id,token}),false);
  const c=await connection('service_role');const args={p_input_id:id,p_token:token};
  assert.equal((await db.rpc('meta_admin_shadow_media_model_start_v1',{...args,p_token:randomUUID()})).data,false);
  const results=await Promise.all([db,rpc(c)].map(d=>d.rpc('meta_admin_shadow_media_model_start_v1',args)));assert.deepEqual(results.map(r=>r.data).sort(),[false,true]);
  await assert.rejects(store.finish({inputId:id,token,status:'complete',reason:'test',run_id:'fake',proposed_response:'Not allowed'}));
  await store.finish({inputId:id,token,status:'blocked',reason:'test'});assert.deepEqual(await counts(id),{status:'blocked',model_calls:0,media_model_calls:1,send_calls:0});
  assert.equal((await db.rpc('meta_admin_shadow_media_model_start_v1',args)).data,false);
  for(const name of ['admin','media'])for(const role of ['anon','authenticated','service_role'])assert.equal((await root.query('select has_function_privilege($1,$2,\'EXECUTE\') x',[role,'public.meta_admin_shadow_'+name+'_model_start_v1(uuid,uuid)'])).rows[0].x,role==='service_role');
  await assert.rejects(service.query('update meta_admin_private.shadow_once_runs set media_model_calls=0'),e=>e.code==='42501');
 });
}
