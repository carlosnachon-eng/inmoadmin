import test from "node:test";
import assert from "node:assert/strict";
import { importWithStubs, response, memoryDb } from "./helpers/socialFixtures.mjs";
import { readHumanAttention, pausedSalesResult } from "../lib/agentsV2/humanAttention.js";
import { extractRespondWebhookEvent } from "../lib/ejecutivo/respondWebhook.js";
import { salesAttentionDelivery } from "../lib/agentsV2/salesAttentionView.js";

test("explicit Respond authorship survives parser independently of assignee; text is not copied",()=>{
  for(const source of ["user","api","workflow","ai_agent",null]){
    const parsed=extractRespondWebhookEvent({event_type:"message.sent",event_id:"synthetic-event",contact:{id:"synthetic-contact",assignee:{id:"synthetic-assignee"}},message:{timestamp:Date.now(),sender:source?{source}:undefined,text:"Synthetic private text"}});
    assert.equal(parsed.payloadMeta.sender_source,source||undefined);
    assert.equal(parsed.payloadMeta.assignee_id,"synthetic-assignee");
    assert.doesNotMatch(JSON.stringify(parsed),/Synthetic private text/);
  }
});
test("missing/malformed pause proof fails closed; policy result has valid non-provider session evidence",async()=>{
  for(const rpc of [async()=>({data:null}),async()=>({error:{code:"42883"}}),async()=>{throw Error("timeout");}]){
    const gate=await readHumanAttention({rpc},{respond_contact_id:"synthetic",occurred_at:new Date().toISOString()});
    assert.deepEqual(gate,{blocked:true,reason:"human_attention_unverified"});
    const result=pausedSalesResult(gate,"synthetic-turn");assert.equal(result.sessionId,"human-review-paused-synthetic-turn");assert.equal(result.output,null);assert.equal(result.humanPaused,true);
  }
});

async function api({role="admin",active=true,user=true,rpcError=null}={}){
  const calls=[],db=memoryDb({profiles:[{id:"synthetic-admin",role_id:role,active}]},{read_respond_human_pause_v1:async()=>({data:{blocked:true,reason:"human_attention_active",episodeKey:"initial",humanEventId:"synthetic-event"}})});
  const handler=(await importWithStubs(new URL("../pages/api/operaciones/respond-human-attention.js",import.meta.url),{
    "@supabase/supabase-js":{createClient:()=>({auth:{getUser:async()=>({data:{user:user?{id:"synthetic-admin"}:null}})},from:db.from,rpc:async(name,args)=>{calls.push({name,args});return{data:rpcError?null:{resumed:true},error:rpcError};}})},
    "../../../lib/ejecutivo/workCenter":{getAdminSupabase:()=>db},
  })).default;return{handler,calls,db};
}
const request={method:"POST",headers:{authorization:"Bearer synthetic"},body:{contactId:"123456",action:"return_to_ai",episodeKey:"initial",humanEventId:"synthetic-event"}};
test("explicit return API: authenticated active admin/manager only, no-store, exact CAS, no queue rewrite",async()=>{
  for(const role of ["admin","gerente_ventas","asesor"]){
    const {handler,calls,db}=await api({role}),res=response();const headers={};res.setHeader=(k,v)=>{headers[k]=v;};
    await handler(request,res);assert.equal(res.statusCode,role==="asesor"?403:200);
    assert.match(headers["Cache-Control"],/no-store/);assert.equal(calls.length,role==="asesor"?0:1);
    if(calls.length)assert.deepEqual(calls[0],{name:"resume_respond_ai_v1",args:{p_contact_id:"123456",p_episode_key:"initial",p_human_event_id:"synthetic-event"}});
    assert.ok(db.operations.every(op=>op.op==="select"));
  }
});
test("API rejects implicit resume, invalid contact, missing identity, inactive account, stale CAS",async()=>{
  for(const [options,req,code] of [
    [{},{...request,headers:{}},401],
    [{user:false},request,401],[{active:false},request,403],
    [{},{...request,body:{...request.body,action:"inbound"}},400],
    [{},{...request,body:{...request.body,contactId:"bad"}},400],
    [{rpcError:{code:"40001"}},request,409],
    [{rpcError:{code:"42501"}},request,403],
  ]){const {handler}=await api(options),res=response();await handler(req,res);assert.equal(res.statusCode,code);}
});
test("GET reports current pause without resuming; blocked sender reason remains visible",async()=>{
  const {handler,calls}=await api(),res=response();await handler({method:"GET",headers:request.headers,query:{contactId:"123456"}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.blocked,true);assert.equal(calls.length,0);
  const projected=salesAttentionDelivery({status:"blocked",error_code:"human_attention_active"});
  assert.ok(JSON.stringify(projected).includes("human_attention_active"));
});
