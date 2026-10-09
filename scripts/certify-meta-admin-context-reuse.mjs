// Hosted DEV driver. No credentials or network calls. The operator executes each
// takeBatch().sql ONLY against inmoadmin-dev, then supplies the returned rows.
// Fixture writes are separate from the SELECT-only reader adapter, rolled back
// after every batch. Snapshot/identity evidence is controlled synthetic input.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAdminShadowContextReaders} from '../lib/messaging/metaAdminCapture/shadowContextReadOnly.js';
import {createRespondCanonicalContextReaders} from '../lib/shadow/canonicalReadOnlyContext.js';

export const DEV_PROJECT='hjfwjnejbcpmknvfpdcq';
const id=n=>`c7be4170-8491-4fe2-9000-${String(n).padStart(12,'0')}`;
const literal=x=>x===null?'null':typeof x==='number'?String(x):typeof x==='boolean'?String(x):`'${String(x).replaceAll("'","''")}'`;
const ident=x=>{assert.match(x,/^[a-z_]+$/);return `"${x}"`;};
const phone='525550109876';
const digest=createHash('sha256').update(phone).digest('hex');
const names=['tenant','owner','multiple_properties','multiple_contracts','revoked','condo','foreign','expired'];
export function createCertification(){
 const clock=Date.now(),now=()=>clock;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(clock));
 const month=date.slice(0,7),year=date.slice(0,4);
 const previous=new Date(Date.UTC(Number(year),Number(month.slice(5))-2,5)).toISOString().slice(0,10);
 const records={client_identities:[],client_identity_roles:[],properties:[],contracts:[],payments:[],client_source_links:[],respond_identity_links:[],condominios:[],unidades_condominio:[]};
 const add=(table,row)=>records[table].push(row);
 for(let i=0;i<names.length;i++){
  const n=i+1,kind=names[i],tenant=['tenant','foreign','expired'].includes(kind),condo=kind==='condo';
  add('client_identities',{id:id(n),status:'active',phone_digest:condo?digest:null});
  add('client_identity_roles',{client_identity_id:id(n),role_kind:tenant?'tenant':'owner',status:'active'});
  if(condo){
   add('condominios',{id:id(500),nombre:'SYNTHETIC_CONTEXT_REUSE',activo:true});
   add('unidades_condominio',{id:id(501),condominio_id:id(500),numero:'SYNTHETIC',propietario_nombre:'SYNTHETIC',propietario_telefono:phone,activo:true});
  }else{
   add('properties',{id:id(100+n),name:'SYNTHETIC_CONTEXT_REUSE',status:'ocupada',owner_client_id:tenant?null:id(n)});
   add('contracts',{id:id(200+n),property_id:id(100+n),tenant_client_id:tenant?id(n):null,status:'activo',
    start_date:`${Number(year)-1}-01-01`,end_date:kind==='expired'?`${Number(year)-1}-12-31`:`${Number(year)+1}-12-31`,monthly_rent:kind==='foreign'?99999:11000});
   add('payments',{id:id(300+n),contract_id:id(200+n),due_date:`${month}-05`,amount:kind==='foreign'?99999:11000,status:'pendiente'});
  }
  add('client_source_links',{id:id(400+n),client_identity_id:id(n),source_type:condo?'condominium_unit_owner':tenant?'active_contract_tenant':'managed_property_owner',
   source_id:condo?id(501):id((tenant?200:100)+n),role_kind:tenant?'tenant':'owner',link_status:kind==='revoked'?'revoked':'confirmed',
   revoked_at:kind==='revoked'?new Date(clock).toISOString():null,match_method:'human_resolution',confirmed_by:id(900),confirmed_at:new Date(clock).toISOString(),
   condominium_id:condo?id(500):null,source_version:condo?1:null});
  add('respond_identity_links',{id:id(600+n),respond_contact_id:`context-reuse-fixture-${n}`,client_identity_id:id(n),link_status:'confirmed',
   link_source:condo?'condominium_owner_admin_review':'human_confirmation',confidence:1,reason_code:'synthetic_certification',confirmed_by:id(900),confirmed_at:new Date(clock).toISOString()});
 }
 add('properties',{id:id(150),name:'SYNTHETIC_SECOND',status:'ocupada',owner_client_id:id(3)});
 add('client_source_links',{...records.client_source_links[2],id:id(450),source_id:id(150)});
 add('contracts',{...records.contracts.find(r=>r.id===id(204)),id:id(250)});
 add('payments',{id:id(350),contract_id:id(201),due_date:previous,amount:88888,status:'pendiente'});
 const insert=(table,rows)=>rows.map(row=>`insert into public.${ident(table)} (${Object.keys(row).map(ident)}) values (${Object.values(row).map(literal)});`).join('\n');
 const setup=`begin; set local statement_timeout='15s';\ninsert into auth.users(id,email,raw_user_meta_data) values (${literal(id(900))},'context-reuse-cert@example.invalid','{"rol_pretendido":"propietario"}'::jsonb);\n`+
 ['client_identities','client_identity_roles','properties','contracts','payments','condominios','unidades_condominio','client_source_links','respond_identity_links'].map(t=>insert(t,records[t])).join('\n');
 let queue=[],active=[],seq=0,done=false;const trace=[],results=[];
 function dbFor(label){return {from(table){assert.ok(Object.hasOwn(records,table));let columns,filters=[],limit=100,order=null;
  const q={select(c){assert.ok(!c.includes('*'));columns=c.split(',');columns.forEach(ident);return q;},
   eq(k,v){filters.push(`${ident(k)}=${literal(v)}`);return q;},in(k,v){filters.push(`${ident(k)} in (${v.map(literal)})`);return q;},
   gte(k,v){filters.push(`${ident(k)}>=${literal(v)}`);return q;},lte(k,v){filters.push(`${ident(k)}<=${literal(v)}`);return q;},
   order(k,o){order=`${ident(k)} ${o?.ascending===false?'desc':'asc'}`;return q;},limit(n){assert.ok(n>0&&n<=101);limit=n;return q;},
   then(resolve,reject){assert.ok(columns&&filters.length);const sql=`select ${columns.map(ident)} from public.${ident(table)} where ${filters.join(' and ')}${order?` order by ${order}`:''} limit ${limit}`;
    assert.ok(sql.includes('c7be4170-8491-4fe2-9000-')||sql.includes('context-reuse-fixture-'));
    trace.push({label,table,columns,sql});return new Promise((yes,no)=>queue.push({key:++seq,sql,yes,no})).then(resolve,reject);}};
  return q;}};}
 function meta(n,label){return createAdminShadowContextReaders({db:dbFor(label),inputId:id(800+n),now,snapshot:async()=>({
  input:{id:id(800+n),waba_id:'1297760461811288',phone_number_id:'1198305790026665',native_message_id:'wamid.synthetic',capture_reason:'captured',message_type:'text',observer_only:true,observer_state:'observed',sanitized_text:'¿Cuánto pago este mes?'},
  enabled:true,scope_channel:'544519',checked_at:new Date(clock).toISOString(),mutated:false,later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,
  identity:{state:'matched',reason:'exact_existing_canonical_phone',candidate_count:1,client_identity_id:id(n),authorizes_business:false}})});}
 const tasks=[];
 function run(label,fn){tasks.push(Promise.resolve().then(fn).then(()=>results.push({scenario:label,status:'PASS'}),e=>results.push({scenario:label,status:'FAIL',reason:e.code||e.message})));}
 for(const n of [1,2])run(`valid_${names[n-1]}_rent_and_respond_parity`,async()=>{
  const m=await meta(n,`valid_${n}`).readAgreement();assert.equal(m.state,'ready');assert.equal(m.agreement.monthly_amount,'11000.00');
  const r=await createRespondCanonicalContextReaders({db:dbFor(`respond_${n}`),respondContactId:`context-reuse-fixture-${n}`,now}).readAgreement();assert.deepEqual(r,m);
 });
 run('authorized_payments_month_and_identity_isolation',async()=>{
  const r=await meta(1,'payments').readCharges();assert.equal(r.state,'ready');assert.equal(r.charges.items.length,1);
  assert.equal(r.charges.items[0].amount,'11000.00');assert.equal(r.charges.items[0].period,month);assert.ok(!JSON.stringify(r).includes('99999'));assert.ok(!JSON.stringify(r).includes('88888'));
 });
 for(const [n,state] of [[3,'ambiguous'],[4,'ambiguous'],[5,'insufficient_context'],[8,'insufficient_context']])run(names[n-1],async()=>{
  const label=names[n-1],r=await meta(n,label).readAgreement();assert.equal(r.state,state);
  assert.ok(trace.filter(t=>t.label===label).every(t=>!t.columns.includes('monthly_rent')&&t.table!=='payments'));
 });
 run('unaccredited_condominium_fee',async()=>{const r=await meta(6,'condo').readAgreement();assert.equal(r.state,'insufficient_context');assert.equal(r.reason,'condominium_fee_source_unverified');});
 run('model_chosen_ids_rejected_without_query',async()=>{const r=await meta(1,'injection').readCharges({contractId:id(207)});assert.equal(r.state,'blocked');assert.ok(!trace.some(t=>t.label==='injection'));});
 Promise.all(tasks).then(()=>done=true);
 return {
  takeBatch(){assert.equal(active.length,0);active=queue;queue=[];if(!active.length)return null;
   return {queries:active.length,sql:setup+'\n'+active.map(q=>`select ${q.key} as key,coalesce(jsonb_agg(t),'[]'::jsonb) as rows from (${q.sql}) t`).join('\nunion all\n')+';\nrollback;'};},
  accept(rows){const pending=active;active=[];for(const q of pending){const row=rows.find(r=>Number(r.key)===q.key);if(!row)q.no(Error('missing_query_result'));else q.yes({data:row.rows,error:null});}},
  status(){return {done,results,queries:trace.length,reader_writes:0,models:0,sends:0,fixture_mode:'transaction_rollback',period:month};},
  fail(){for(const q of [...active,...queue])q.no(Error('hosted_source_failed'));active=[];queue=[];},
  trace(){return trace;},
 };
}
