import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export async function certifyObservationBoundary(db){
 await db.query(await readFile(new URL('../supabase/migrations/20261026160230_comment_observation_only_boundary.sql',import.meta.url),'utf8'));
 const actor=randomUUID(),denied=randomUUID(),connection=randomUUID();let checks=0;
 const ok=x=>{assert.ok(x);checks++;};
 await db.query("insert into profiles values($1,true,'admin'),($2,true,'asesor')",[actor,denied]);
 await db.query("insert into commercial_comment_private.connections(platform,connection_id,active,observation_only) values('facebook',$1,true,true)",[connection]);
 const call=(op,who=actor)=>db.query("select public.comment_observation_v1('facebook',$1,$2,$3,'{}') v",[connection,who,op]);
 assert.deepEqual((await call('list')).rows[0].v,[]);checks++;
 for(const op of ['claim','start','send','publish']){await assert.rejects(call(op),e=>e.code==='42501');checks++;}
 await assert.rejects(call('list',denied),e=>e.code==='42501');checks++;
 await assert.rejects(db.query('update commercial_comment_private.connections set sender_enabled=true where connection_id=$1',[connection]),e=>e.code==='23514');checks++;
 // Even an owner-level accidental insertion cannot create an outbound action.
 await assert.rejects(db.query("insert into commercial_comment_private.actions(platform,connection_id,comment_ref,action,revision,actor,status) values('facebook',$1,$2,$3,$2,$4,'claimed')",[connection,'a'.repeat(64),randomUUID(),actor]),e=>e.code==='42501'&&e.message==='observation_has_no_actions');checks++;
 for(const role of ['anon','authenticated'])ok(!(await db.query("select has_function_privilege($1,'public.comment_observation_v1(text,uuid,uuid,text,jsonb)','execute') v",[role])).rows[0].v);
 ok((await db.query("select has_function_privilege('service_role','public.comment_observation_v1(text,uuid,uuid,text,jsonb)','execute') v")).rows[0].v);
 ok((await db.query('select count(*)::int n from commercial_comment_private.actions where connection_id=$1',[connection])).rows[0].n===0);
 console.log(JSON.stringify({observation_boundary_checks:checks,result:'PASS',scope:'disposable_local_synthetic',dispatches:0}));
}
