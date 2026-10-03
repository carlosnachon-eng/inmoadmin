import test from "node:test";
import assert from "node:assert/strict";
import { captureSocialRouteSafely, safeCaptureDiagnostic, socialCaptureReview } from "../lib/social/captureReceipt.js";
import { readSocialContinuity } from "../lib/social/continuity.js";
import { createSocialRoutingReviewHandler } from "../pages/api/operaciones/social-routing.js";
import { memoryDb, response } from "./helpers/socialFixtures.mjs";

const env = { SOCIAL_ROUTING_V1_ENABLED: "true" };
const event = { eventId:"qa-event",messageId:"qa-message",respondContactId:"qa-contact",channelId:"497382",eventType:"message.received",eventOccurredAt:"2026-10-03T12:00:00Z" };
const body = { message:{text:"Busco casa en renta"} };
function fixture(capture) {
  const receipt = {state:"pending",attempts:0}; let calls=0;
  const db = memoryDb({}, {
    begin_social_capture_v1:async()=>{receipt.attempts++;return {data:{...receipt}};},
    capture_social_route_v1:async args=>{calls++;return capture(args,receipt,db);},
    fail_social_capture_v1:async args=>{receipt.state="review_required";receipt.diagnostic=args;return {data:{...receipt}};},
  });
  return {db,receipt,calls:()=>calls};
}
test("four deliveries of an unrecoverable error leave one terminal review, no four capture failures",async()=>{
  const f=fixture(()=>({error:{code:"23514",message:"sensitive client text must never be stored"}}));
  for(let i=0;i<4;i++)assert.equal((await captureSocialRouteSafely(f.db,body,event,{env})).status,"review_required");
  assert.equal(f.calls(),1);assert.equal(f.receipt.attempts,4);
  assert.deepEqual(f.receipt.diagnostic,{p_event_id:event.eventId,p_sqlstate:"23514",p_reason:"capture_rpc_failed",p_stage:"capture_rpc"});
  assert.doesNotMatch(JSON.stringify(f.receipt),/sensitive|client text/);
});
test("stale CAS is re-read/reclassified before any effect, at most three DB attempts",async()=>{
  let n=0;const f=fixture(()=>++n<3?{error:{code:"P0001",message:"social_context_changed_requires_review"}}:{data:{created:true,destination:"SALES",inboundId:"i"}});
  assert.equal((await captureSocialRouteSafely(f.db,body,event,{env})).created,true);
  assert.equal(f.calls(),3);
  assert.equal(f.db.operations.filter(o=>o.table==="read_social_route_context_v1").length,3);
  assert.equal(f.db.operations.filter(o=>o.table==="fail_social_capture_v1").length,0);
});
test("exhausted CAS becomes one review; Respond retries cannot reopen it",async()=>{
  const f=fixture(()=>({error:{code:"P0001",message:"social_context_changed_requires_review"}}));
  for(let i=0;i<4;i++)await captureSocialRouteSafely(f.db,body,event,{env});
  assert.equal(f.calls(),3);assert.equal(f.receipt.diagnostic.p_reason,"context_conflict");
});
test("unknown transport outcome does not retry capture automatically",async()=>{
  const f=fixture(()=>{throw new Error("secret provider token payload");});
  await captureSocialRouteSafely(f.db,body,event,{env});assert.equal(f.calls(),1);
  assert.equal(f.receipt.diagnostic.p_sqlstate,null);assert.doesNotMatch(JSON.stringify(f.receipt),/secret|token|payload/);
});
test("missing message identity is visible, no specialist or model",async()=>{
  const f=fixture(()=>assert.fail());
  assert.equal((await captureSocialRouteSafely(f.db,body,{...event,messageId:null},{env})).status,"review_required");
  assert.equal(f.receipt.diagnostic.p_reason,"invalid_message_identity");assert.equal(f.calls(),0);
});
test("durable pending remains fail closed if review persistence itself is unavailable",async()=>{
  const f=fixture(()=>({error:{code:"08006"}}));const rpc=f.db.rpc.bind(f.db);
  f.db.rpc=(name,args)=>name==="fail_social_capture_v1"?{error:{code:"08006"}}:rpc(name,args);
  await assert.rejects(captureSocialRouteSafely(f.db,body,event,{env}),/review_persistence_unavailable/);
  assert.equal(f.receipt.state,"pending");assert.equal(f.calls(),1);
});
test("deterministic current and historical heads are separate; late Sales cannot replace current Owner",async()=>{
  const f=fixture(({p_route})=>({data:{created:true,destination:p_route.destination,reason:p_route.reason}}));
  f.db.tables.social_message_routes=[
    {id:"a",respond_contact_id:event.respondContactId,source_channel_id:"497382",destination:"SALES",occurred_at:"2026-10-02T12:00:00Z",created_at:"2026-10-02T12:00:01Z"},
    {id:"b",respond_contact_id:event.respondContactId,source_channel_id:"497382",destination:"OWNER",occurred_at:"2026-10-03T12:00:02Z",created_at:"2026-10-03T12:00:03Z"},
  ];
  const context=await readSocialContinuity(f.db,event.respondContactId,"497382",event.eventOccurredAt);
  assert.equal(context.previous.id,"b");assert.equal(context.historical.id,"a");assert.equal(context.owner,true);
  const r=await captureSocialRouteSafely(f.db,body,event,{env});assert.equal(r.destination,"HUMAN_REVIEW");assert.equal(r.reason,"late_message_requires_review");
});
test("safe diagnostic never echoes unknown code, message, details, hints, body or aliases",()=>{
  assert.deepEqual(safeCaptureDiagnostic({code:"private",message:"private",details:"private",hint:"private"},"private"),{sqlstate:null,reason:"capture_failed",stage:"transport"});
  const r=socialCaptureReview({source_event_id:"raw-event",respond_contact_id:"raw-contact",reason:"private",sqlstate:"private",stage:"private",rpc_name:"private",payload:"private"});
  assert.doesNotMatch(JSON.stringify(r),/raw-event|raw-contact|private/);
});
test("processed snapshot does not hide capture review; GET OFF is authenticated/read-only",async()=>{
  const db=memoryDb({social_capture_receipts:[{source_event_id:"private-event",respond_contact_id:"private-contact",routing_state:"review_required",route_id:null,reason:"capture_rpc_failed",sqlstate:"23514",attempts:4,transport:{status:"processed",processed_at:"2026-10-03T12:05:00Z"}}]});
  const res=response();await createSocialRoutingReviewHandler({authorize:async()=>({active:true,role_id:"admin"}),createAdmin:()=>db,env:{}})({method:"GET",headers:{}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.enabled,false);assert.equal(res.body.captureReviews.length,1);
  assert.equal(res.body.captureReviews[0].snapshotState,"processed");assert.equal(res.body.captureReviews[0].routingState,"review_required");
  assert.ok(res.body.captureReviews[0].operationalOwner);assert.ok(db.operations.every(o=>o.op==="select"));
  assert.doesNotMatch(JSON.stringify(res.body),/private-event|private-contact/);
});
test("OFF / Admin / outbound skip all new capture effects",async()=>{
  const db={rpc(){assert.fail();}};
  for(const [e,config] of [[event,{}],[{...event,channelId:"544519"},env],[{...event,eventType:"message.sent"},env]])assert.deepEqual(await captureSocialRouteSafely(db,body,e,{env:config}),{handled:false});
});
test("review pagination preserves access to old and fresh failures, including late routed reviews",async(t)=>{
  const oldWorkspace=process.env.RESPOND_IO_WORKSPACE_ID;
  process.env.RESPOND_IO_WORKSPACE_ID="qa-workspace-never-called";
  t.after(()=>{if(oldWorkspace===undefined)delete process.env.RESPOND_IO_WORKSPACE_ID;else process.env.RESPOND_IO_WORKSPACE_ID=oldWorkspace;});
  const rows=Array.from({length:101},(_,i)=>({source_event_id:`qa-${String(i).padStart(3,"0")}`,respond_contact_id:"99999999",routing_state:"review_required",route_id:i===100?"late-route":null,reason:"late_message_requires_review",first_received_at:"2030-01-01T00:00:00Z"}));
  const db=memoryDb({social_capture_receipts:rows});
  const handler=createSocialRoutingReviewHandler({authorize:async()=>({active:true,role_id:"admin"}),createAdmin:()=>db,env:{}});
  const first=response();await handler({method:"GET",headers:{},query:{capturePage:"0"}},first);
  assert.equal(first.body.captureReviews.length,100);assert.equal(first.body.captureHasMore,true);
  const second=response();await handler({method:"GET",headers:{},query:{capturePage:"1"}},second);
  assert.equal(second.body.captureReviews.length,1);assert.equal(second.body.captureHasMore,false);assert.ok(second.body.captureReviews[0].inboxUrl);
  const invalid=response();await handler({method:"GET",headers:{},query:{capturePage:"-1"}},invalid);assert.equal(invalid.statusCode,400);
});
test("thrown receipt transport failures are never echoed",async()=>{
  await assert.rejects(captureSocialRouteSafely({rpc(){throw new Error("private payload token");}},body,event,{env}),e=>e.message==="social_capture_receipt_unavailable");
});
test("capture anchors missing or changed timestamps to durable transport time",async()=>{
  const f=fixture(({p_route})=>{assert.equal(p_route.occurred_at,"2030-01-01T00:00:00Z");return{data:{created:true}};});
  const rpc=f.db.rpc.bind(f.db);f.db.rpc=(name,args)=>name==="begin_social_capture_v1"?{data:{state:"pending",occurredAt:"2030-01-01T00:00:00Z"}}:rpc(name,args);
  await captureSocialRouteSafely(f.db,body,{...event,eventOccurredAt:null},{env});
});
