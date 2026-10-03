import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { salesOutboundStorageKind } from "../../lib/agentsV2/salesAutoOutbound.js";

export async function certifySalesRecoveryPostgres(db, connect, check) {
  await db.query(await readFile(new URL("../../supabase/migrations/202610010001_sales_agent_v2_auto_outbound.sql",import.meta.url),"utf8"));
  const inbound=(await db.query(`insert into sales_agent_v2_inbound_messages(event_id,respond_contact_id,channel_id,occurred_at,sanitized_text,status)
    values('sales-recovery-pg','sales-recovery-pg','497382',now(),'Información de una casa sintética','processed') returning id`)).rows[0].id;
  const run=(await db.query(`insert into sales_agent_v2_shadow_runs(inbound_message_id,session_id,status,proposed_response,completed_at)
    values($1,'synthetic-recovery','idle','Te confirmo cuál es.',now()) returning id`,[inbound])).rows[0].id;
  const a=await connect("service_role"),b=await connect("service_role");
  const insert=`insert into sales_agent_v2_auto_outbound(inbound_message_id,shadow_run_id,respond_contact_id,channel_id,case_kind,status,proposed_message,error_code)
    values($1,$2,'sales-recovery-pg','497382','greeting_qualification','blocked','Sin envío sintético','appointment_commitment_requires_validation') returning id`;
  const claims=await Promise.allSettled([a.query(insert,[inbound,run]),b.query(insert,[inbound,run])]);
  check("sales recovery: real unique constraints admit one durable sender outcome",()=>{
    assert.equal(claims.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(claims.find(r=>r.status==="rejected").reason.code,"23505");
  });
  const stored=(await db.query("select status,error_code,provider_message_id,sent_at from sales_agent_v2_auto_outbound where inbound_message_id=$1",[inbound])).rows;
  check("sales recovery: blocked reason read-back, no delivery or provider receipt",()=>{
    assert.equal(stored.length,1);assert.equal(stored[0].status,"blocked");
    assert.equal(stored[0].error_code,"appointment_commitment_requires_validation");
    assert.equal(stored[0].provider_message_id,null);assert.equal(stored[0].sent_at,null);
  });
  const acl=(await db.query(`select relrowsecurity,has_table_privilege('service_role','sales_agent_v2_auto_outbound','SELECT,INSERT,UPDATE') as service,
    has_table_privilege('anon','sales_agent_v2_auto_outbound','SELECT') as anon,
    has_table_privilege('authenticated','sales_agent_v2_auto_outbound','SELECT') as authenticated
    from pg_class where oid='sales_agent_v2_auto_outbound'::regclass`)).rows[0];
  check("sales recovery: RLS and server-only ACL retained",()=>assert.deepEqual(acl,{relrowsecurity:true,service:true,anon:false,authenticated:false}));
  await assert.rejects(db.query("update sales_agent_v2_auto_outbound set case_kind='rental_requirements' where inbound_message_id=$1",[inbound]),error=>error.code==="23514");
  check("sales recovery: original constraint still rejects rental_requirements",()=>{});
  await a.query("update sales_agent_v2_auto_outbound set case_kind=$1 where inbound_message_id=$2",[salesOutboundStorageKind("rental_requirements"),inbound]);
  check("sales recovery: rental classification maps to an existing category without DDL",()=>{});
}
