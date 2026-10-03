import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { captureSocialRouteSafely } from "../../lib/social/captureReceipt.js";
import { readSocialContinuity } from "../../lib/social/continuity.js";
import { processSocialRouteImmediate } from "../../lib/social/immediate.js";

// Real PostgreSQL behind the actual router. This adapter only binds SQL reads
// and RPC arguments; it does not implement classification, CAS or idempotency.
function adapter(pg) {
  return {
    async rpc(name,args){
      assert.ok(["read_social_route_context_v1","begin_social_capture_v1","capture_social_route_v1","fail_social_capture_v1"].includes(name));
      try {const r=await pg.query(`select public.${name}(${Object.keys(args).map((_,i)=>`$${i+1}`).join(",")}) result`,Object.values(args));return {data:r.rows[0].result,error:null};}
      catch(e){return {data:null,error:{code:e.code,message:e.message}};}
    },
    from(table){
      assert.ok(["respond_identity_links","client_identities","owner_agent_v1_inbound_messages","gv_respond_contact_snapshots","sales_agent_v2_inbound_messages"].includes(table));
      let fields="*",filters=[],params=[],orders=[],limit=100,single=false;
      const identifier=k=>{assert.match(k,/^[a-z_]+$/);return k;};
      const q={select(s){assert.match(s,/^[a-z_,*]+$/);fields=s;return q;},
        eq(k,v){params.push(v);filters.push(`${identifier(k)}=$${params.length}`);return q;},
        lte(k,v){params.push(v);filters.push(`${identifier(k)}<=$${params.length}`);return q;},
        gt(k,v){params.push(v);filters.push(`${identifier(k)}>$${params.length}`);return q;},
        in(k,v){params.push(v);filters.push(`${identifier(k)}=any($${params.length})`);return q;},
        order(k,o){orders.push(`${identifier(k)} ${o?.ascending===false?"desc":"asc"}`);return q;},
        limit(n){assert.ok(Number.isInteger(n)&&n>0&&n<=100);limit=n;return q;},
        maybeSingle(){single=true;return q;},single(){single=true;return q;},
        async then(ok,fail){try{
          const r=await pg.query(`select row_to_json(t) item from (select ${fields} from public.${table} ${filters.length?`where ${filters.join(" and ")}`:""} ${orders.length?`order by ${orders.join(",")}`:""} limit ${limit}) t`,params);
          return ok({data:single?r.rows[0]?.item||null:r.rows.map(r=>r.item),error:null});
        }catch(e){return ok({data:null,error:{code:e.code,message:e.message}});}},
      };return q;
    },
  };
}

export async function certifySocialCapturePostgres(db,connect,check){
  // The earlier fixture has only the upstream transport PK. Add the actual
  // columns used here, and load the unchanged snapshot completion FUNCTION.
  await db.query(`alter table gv_respond_webhook_events add column event_type text,add column respond_contact_id text,
    add column message_id text,add column payload_meta jsonb,add column event_occurred_at timestamptz,
    add column status text default 'pending',add column processed_at timestamptz,add column next_attempt_at timestamptz,
    add column locked_at timestamptz,add column locked_by uuid,add column last_error text;
    create table gv_respond_contact_snapshots(respond_contact_id text,atn_area text,atn_servicio text,atn_estado text,respond_channel_id text);
    grant select on gv_respond_contact_snapshots to service_role;`);
  const original=await readFile(new URL("../../supabase/migrations/202608100003_fase_2a1a_respond_incremental_webhooks.sql",import.meta.url),"utf8");
  const snapshot=original.match(/create or replace function public\.apply_respond_snapshot_and_complete_events\([\s\S]*?\n\$\$;/)[0];
  await db.query(snapshot);
  const migration=await readFile(new URL("../../supabase/migrations/20261003201853_social_capture_failsafe.sql",import.meta.url),"utf8");
  const originalCapture=(await db.query("select pg_get_functiondef('public.capture_social_route_v1(jsonb)'::regprocedure) body")).rows[0].body;
  await db.query(migration);
  const postcheck=await readFile(new URL("../../supabase/checks/social_capture_failsafe.sql",import.meta.url),"utf8");
  const verifyCatalog=async()=>{for(const result of await db.query(postcheck))for(const row of result.rows)for(const v of Object.values(row))if(typeof v==="boolean")assert.equal(v,true);};
  await verifyCatalog();
  const rollback=await readFile(new URL("../../supabase/rollback/social_capture_failsafe_empty_only.sql",import.meta.url),"utf8");
  await db.query(rollback);assert.equal((await db.query("select to_regclass('public.social_capture_receipts') x")).rows[0].x,null);
  assert.equal((await db.query("select pg_get_functiondef('public.capture_social_route_v1(jsonb)'::regprocedure) body")).rows[0].body,originalCapture);
  const restored=(await db.query("select public.capture_social_route_v1($1) result",[{source_event_id:"event-1",source_channel_id:"497382",respond_contact_id:"contact-1",source_message_id:"message-1"}])).rows[0].result;
  assert.equal(restored.created,false);assert.equal(restored.destination,"SALES");
  await db.query(migration);await verifyCatalog();
  check("P1 empty-only rollback and catalog postcheck",()=>{});
  const a=await connect("service_role"),b=await connect("service_role"),api=adapter(a),apiB=adapter(b);
  const env={SOCIAL_ROUTING_V1_ENABLED:"true",SALES_AGENT_V2_AUTO_SHADOW_ENABLED:"true"};
  let sequence=0;
  const seed=async(contact,at,channel="497382")=>{
    const n=++sequence,e={eventType:"message.received",eventId:`qa-capture-event-${n}`,messageId:`qa-capture-message-${n}`,respondContactId:contact,channelId:channel,eventOccurredAt:at};
    await a.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,message_id,event_occurred_at,payload_meta) values($1,$2,$3,$4,$5,$6)",[e.eventId,e.eventType,contact,e.messageId,at,{channel_id:channel,social_capture_required:true}]);return e;
  };
  const run=(e,text="Busco casa en renta",client=api)=>captureSocialRouteSafely(client,{message:{text}},e,{env});
  const receipt=e=>db.query("select * from social_capture_receipts where source_event_id=$1",[e.eventId]).then(r=>r.rows[0]);
  const t="2030-01-01T12:00:00Z",later="2030-01-01T12:00:02Z";
  const newer=await seed("qa-capture-reversed",later),older=await seed("qa-capture-reversed",t);
  const first=await run(newer),late=await run(older);
  check("P1 inverted arrival: later routes, late message gets one durable review without P0001",()=>{
    assert.equal(first.destination,"SALES");assert.equal(late.destination,"HUMAN_REVIEW");assert.equal(late.inboundId,null);
  });
  for(let i=0;i<3;i++)assert.equal((await run(older)).status,"review_required");
  const reviewed=await receipt(older);
  check("P1 3 Respond retries: 1 late review, four deliveries, no specialist",()=>{assert.equal(reviewed.attempts,4);assert.equal(reviewed.reason,"late_message_requires_review");});
  assert.equal((await db.query("select count(*)::int n from social_message_routes where source_event_id=$1",[older.eventId])).rows[0].n,1);

  const tied1=await seed("qa-capture-tied",t),tied2=await seed("qa-capture-tied",t);
  const tieA=await run(tied1),tieB=await run(tied2);
  // Exercise final UUID tie-break with equal timestamps (fixture-only SQL).
  await db.query("update social_message_routes set created_at='2030-01-01T12:00:03Z' where respond_contact_id='qa-capture-tied'");
  const selected=await readSocialContinuity(api,"qa-capture-tied","497382",t);
  const expected=[tieA.routeId,tieB.routeId].sort().at(-1);
  check("P1 exact timestamp ties share stable UUID ordering",()=>assert.equal(selected.previous.id,expected));
  const tied3=await seed("qa-capture-tied",t);assert.equal((await run(tied3)).destination,"SALES");

  const owner=await seed("qa-capture-owner",later);await run(owner,"Soy propietario y quiero vender mi casa");
  const ownerLate=await seed("qa-capture-owner",t);await run(ownerLate,"Quiero comprar una casa");
  const day2=await seed("qa-capture-owner","2030-01-02T12:00:00Z");assert.equal((await run(day2,"Perfecto")).destination,"OWNER");
  check("P1 late Sales cannot overwrite current Owner; next-day continuity remains Owner",()=>{});
  for(const [channel,text,destination] of [["498219","Qué incluye la póliza jurídica","LEGAL"],["515318","Consulta de mantenimiento del condominio","ADMINISTRATION"]]){
    const e=await seed(`qa-capture-${destination}`,t,channel),r=await run(e,text);assert.equal(r.destination,destination);
    check(`P1 exclusive ${destination}, original source channel`,()=>{});
  }

  const same=await seed("qa-capture-same",t);
  const results=await Promise.all([run(same,undefined,api),run(same,undefined,apiB)]);
  check("P1 simultaneous deliveries create exactly one route/inbound",()=>assert.equal(results.filter(r=>r.created).length,1));
  const result=results.find(r=>r.created);let effects=0;
  for(const r of results)await processSocialRouteImmediate(api,r,{SALES:async()=>{effects++;return {status:"intercepted_no_network"};}},{env,sleep:async()=>{}});
  check("P1 actual dispatcher: one intercepted processor effect, zero duplicate dispatch",()=>assert.equal(effects,1));
  for(let i=0;i<3;i++)assert.equal((await run(same)).status,"routed");
  assert.equal((await db.query("select count(*)::int n from sales_agent_v2_inbound_messages where event_id=$1",[same.eventId])).rows[0].n,1);

  // Force an independently blocked transaction, not merely Promise scheduling.
  const ca=await seed("qa-capture-concurrent",t),cb=await seed("qa-capture-concurrent",later);
  await a.query("begin");const current=await run(ca,"Soy propietario, quiero vender mi casa",api);
  const pending=run(cb,"Perfecto",apiB);let blocked=false;
  for(let i=0;i<100;i++) {if((await db.query("select $1::int=any(pg_blocking_pids($2::int)) blocked",[a.processID,b.processID])).rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.equal(blocked,true);await a.query("commit");const waited=await pending;
  check("P1 real concurrent conversation lock preserves OWNER",()=>{assert.equal(current.destination,"OWNER");assert.equal(waited.destination,"OWNER");});

  // Interleave AFTER reading context but BEFORE capture; real DB CAS must fail,
  // then the real wrapper re-reads/reclassifies without a model or remote effect.
  const casA=await seed("qa-capture-cas",t),casB=await seed("qa-capture-cas",later);
  let injected=false,conflicts=0;
  const interleaved={...apiB,rpc:async(name,args)=>{
    if(name==="capture_social_route_v1"&&!injected){injected=true;await run(casA,"Soy propietario y quiero vender mi casa",api);}
    const result=await apiB.rpc(name,args);if(result.error?.message==="social_context_changed_requires_review")conflicts++;
    return result;
  }};
  const recovered=await run(casB,"Perfecto",interleaved);
  check("P1 actual stale CAS: exactly one conflict then reclassifies OWNER",()=>{assert.equal(conflicts,1);assert.equal(recovered.destination,"OWNER");});

  // Same provider message under another event id still shares one receipt.
  const alias={...same,eventId:"qa-capture-provider-alias"};
  await a.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,message_id,event_occurred_at,payload_meta) values($1,$2,$3,$4,$5,$6)",[alias.eventId,alias.eventType,alias.respondContactId,alias.messageId,t,{channel_id:"497382",social_capture_required:true}]);
  assert.equal((await run(alias)).status,"routed");
  check("P1 provider dedupe aliases share one receipt/decision",()=>{});
  assert.equal((await db.query("select count(*)::int n from social_capture_receipts where respond_contact_id=$1",[same.respondContactId])).rows[0].n,1);

  // A new delivery of untracked pre-rollout transport never replays history.
  const old={...same,eventId:"qa-capture-old",messageId:"qa-capture-old",respondContactId:"qa-capture-old"};
  await a.query("insert into gv_respond_webhook_events(event_id,event_type,respond_contact_id,message_id,payload_meta,status) values($1,$2,$3,$4,$5,'processed')",[old.eventId,old.eventType,old.respondContactId,old.messageId,{channel_id:"497382"}]);
  for(let i=0;i<4;i++)assert.equal((await run(old)).status,"review_required");
  const oldReceipt=await receipt(old);
  check("P1 pre-rollout delivery exposes one review, never retroactive processing",()=>{assert.equal(oldReceipt.reason,"preexisting_transport_requires_review");assert.equal(oldReceipt.attempts,4);assert.equal(oldReceipt.route_id,null);});

  const bad=await seed("qa-capture-failure",t);
  const failing={...api,rpc:async(name,args)=>name==="capture_social_route_v1"?{error:{code:"23514",message:"PRIVATE fixture value never persist"}}:api.rpc(name,args)};
  for(let i=0;i<4;i++)await run(bad,"Busco casa",failing);
  const worker=randomUUID();await db.query("update gv_respond_webhook_events set status='processing',locked_by=$2,last_error='synthetic snapshot error' where event_id=$1",[bad.eventId,worker]);
  await db.query("select apply_respond_snapshot_and_complete_events(null,$1,$2)",[[bad.eventId],worker]);
  const after=await receipt(bad),transport=(await db.query("select status,last_error from gv_respond_webhook_events where event_id=$1",[bad.eventId])).rows[0];
  check("P1 REAL snapshot function processed/clears last_error but cannot hide commercial review",()=>{
    assert.equal(transport.status,"processed");assert.equal(transport.last_error,null);assert.equal(after.routing_state,"review_required");assert.equal(after.attempts,4);assert.equal(after.sqlstate,"23514");assert.doesNotMatch(JSON.stringify(after),/PRIVATE/);
  });
  // A delayed loser cannot rewrite a successful receipt.
  await a.query("select fail_social_capture_v1($1,'P0001','context_conflict','capture_rpc')",[same.eventId]);
  check("P1 late losing request cannot turn routed into review",()=>{});assert.equal((await receipt(same)).routing_state,"routed");
  const anon=await connect("anon"),auth=await connect("authenticated");
  for(const c of [anon,auth]){
    await assert.rejects(c.query("select * from social_capture_receipts"),e=>e.code==="42501");
    await assert.rejects(c.query("select begin_social_capture_v1($1)",[bad.eventId]),e=>e.code==="42501");
    await assert.rejects(c.query("select read_social_route_context_v1('c','497382',now())"),e=>e.code==="42501");
  }
  await assert.rejects(a.query("update social_capture_receipts set routing_state='pending'"),e=>e.code==="42501");
  check("P1 RLS/ACL: anon/auth denied; service cannot rewrite receipts",()=>{});
  const allowed=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='social_capture_receipts'")).rows.map(r=>r.column_name);
  check("P1 receipt schema has no text, tokens, secrets, payload or alias columns",()=>assert.ok(allowed.every(k=>!/(sanitized_text|payload|token|secret|alias)/.test(k))));
  await assert.rejects(db.query(rollback),/social_capture_rollback_refused_evidence_exists/);await db.query("rollback");
  check("P1 rollback refuses nonempty diagnostic evidence",()=>{});
}
