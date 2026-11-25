import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
export async function certifyAssociations(db,db2){
 let checks=0;const ok=x=>{assert.ok(x);checks++;};const actor=randomUUID(),denied=randomUUID(),conn=randomUUID(),other=randomUUID(),pid=randomUUID(),pid2=randomUUID(),r=n=>String(n).repeat(64);
 await db.query('create table public.propiedades(id uuid primary key,public_id text,status text);');
 await db.query(await readFile(new URL('../supabase/migrations/20261023184956_comment_property_association.sql',import.meta.url),'utf8'));
 await db.query("insert into profiles values($1,true,'admin'),($2,true,'asesor')",[actor,denied]);
 await db.query("insert into propiedades values($1,'EMP-QA1','published'),($2,'EMP-QA2','published')",[pid,pid2]);
 await db.query("insert into commercial_comment_private.connections(platform,connection_id,active) values('facebook',$1,true),('instagram',$1,true),('facebook',$2,true)",[conn,other]);
 await db.query("select public.comment_review_v1('facebook',$1,null,'capture',$2)",[conn,{event_ref:r(1),comment_ref:r(2),post_ref:r(3),occurred_at:new Date().toISOString(),content_box:{synthetic:true},native_box:{synthetic:true}}]);
 const data={event_ref:r(1),post_ref:r(3),property_public_id:'EMP-QA1',evidence_box:{synthetic:true}};
 const call=async(op,d=data,who=actor,connection=conn,platform='facebook',client=db)=>(await client.query('select public.comment_property_link_v1($1,$2,$3,$4,$5) v',[platform,connection,who,op,d])).rows[0].v;
 ok(await call('read')===null);
 await assert.rejects(call('bind',data,denied),e=>e.code==='42501');checks++;
 ok((await call('bind',data,actor,other)).status==='event_unavailable');
 ok((await call('bind',data,actor,conn,'instagram')).status==='event_unavailable');
 ok((await call('bind',{...data,property_public_id:'EB-NOT-IN-DEV'})).status==='property_unavailable');
 const race=await Promise.all([call('bind'),call('bind',data,actor,conn,'facebook',db2)]);ok(race.filter(x=>x.status==='bound').length===1);ok(race.filter(x=>x.status==='unchanged').length===1);
 ok((await call('bind',{...data,property_public_id:'EMP-QA2'})).status==='association_conflict');
 ok((await call('read')).property_id===pid);ok(await call('read',data,actor,other)===null);
 ok((await db.query("select count(*)::int n from commercial_comment_private.audit where connection_id=$1 and kind='property_bind'",[conn])).rows[0].n===1);
 await db.query("update commercial_comment_private.connections set sender_enabled=true where platform='facebook' and connection_id=$1",[conn]);
 await assert.rejects(call('bind'),e=>e.code==='42501');checks++;
 await db.query("update commercial_comment_private.connections set sender_enabled=false where connection_id=$1",[conn]);
 for(const role of ['anon','authenticated'])ok(!(await db.query("select has_function_privilege($1,'public.comment_property_link_v1(text,uuid,uuid,text,jsonb)','execute') v",[role])).rows[0].v);
 ok((await db.query("select relrowsecurity from pg_class where oid='commercial_comment_private.property_links'::regclass")).rows[0].relrowsecurity);
 ok((await db.query('select count(*)::int n from commercial_comment_private.actions where connection_id=$1',[conn])).rows[0].n===0);
 console.log(JSON.stringify({association_checks:checks,result:'PASS',scope:'disposable_local_synthetic',dispatches:0}));
}
