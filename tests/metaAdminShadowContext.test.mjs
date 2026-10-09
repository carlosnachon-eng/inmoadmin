import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createAdminShadowContextReaders,prepareAdminShadowContext} from '../lib/messaging/metaAdminCapture/shadowContextReadOnly.js';
import {createRespondCanonicalContextReaders} from '../lib/shadow/canonicalReadOnlyContext.js';
import {shadowContextTools,validateShadowToolArguments} from '../lib/shadow/context.js';
import {runMetaAdminShadowOnceWithContext} from '../lib/messaging/metaAdminCapture/shadowOnceWithContext.js';
import {restrictedAdminRequest} from '../lib/messaging/metaAdminCapture/shadowOnce.js';
import {createShadowOnceOperator} from '../lib/messaging/metaAdminCapture/shadowOnceOperator.js';
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const now=()=>Date.parse('2026-10-09T01:30:00Z');
const phone='525550100001',digest=createHash('sha256').update(phone).digest('hex');
function tables(kind='tenant'){
 const data={respond_identity_links:[{id:id(50),respond_contact_id:'fixture-contact',client_identity_id:id(1),link_status:'confirmed',link_source:kind==='condo'?'condominium_owner_admin_review':'human_confirmation',confidence:1}],
 client_identities:[{id:id(1),status:'active',revoked_at:null,phone_digest:digest}],
 client_identity_roles:[{client_identity_id:id(1),role_kind:kind==='tenant'?'tenant':'owner',status:'active',revoked_at:null}],
 client_source_links:[{client_identity_id:id(1),source_type:kind==='tenant'?'active_contract_tenant':kind==='owner'?'managed_property_owner':'condominium_unit_owner',
 source_id:kind==='tenant'?id(3):kind==='owner'?id(2):id(4),role_kind:kind==='tenant'?'tenant':'owner',link_status:'confirmed',revoked_at:null,
 condominium_id:kind==='condo'?id(5):null,source_version:kind==='condo'?1:null}],
 properties:[{id:id(2),status:'ocupada',owner_client_id:kind==='owner'?id(1):id(90),name:'THIRD_PARTY_NAME'}],
 contracts:[{id:id(3),property_id:id(2),tenant_client_id:kind==='tenant'?id(1):id(90),status:'activo',start_date:'2026-01-01',end_date:'2026-12-31',
 monthly_rent:'11000',tenant_name:'THIRD_PARTY_NAME',owner_email:'private@example.invalid',commission_value:999}],
 payments:[{contract_id:id(3),due_date:'2026-10-05',amount:'11000.00',status:'pagado',receipt_url:'PRIVATE_RECEIPT'},
 {contract_id:id(99),due_date:'2026-10-05',amount:'77777',status:'atrasado'},
 {contract_id:id(3),due_date:'2026-09-05',amount:'11000',status:'atrasado'}],
 unidades_condominio:[{id:id(4),condominio_id:id(5),activo:true,identity_owner_version:1,propietario_telefono:phone,numero:'PRIVATE_LABEL'}],
 condominios:[{id:id(5),activo:true,cuota_mensual:'850.50',nombre:'PRIVATE_LABEL'}],
 cuotas_condominio:[{condominio_id:id(5),unidad_id:id(4),periodo:'2026-10',fecha_vencimiento:'2026-10-10',monto:'850.50',status:'pendiente'},
 {condominio_id:id(5),unidad_id:id(99),periodo:'2026-10',fecha_vencimiento:'2026-10-10',monto:'99999',status:'pagado'}]};
 return data;
}
function fixture({kind='tenant',change=()=>{},onQuery=()=>{},snapshotChange=()=>{}}={}){
 const data=tables(kind);change(data);const reads=[],writes=[];let snaps=0;
 const forbidden=()=>{writes.push('attempt');throw Error('write_forbidden');};
 const db={rpc:forbidden,from(table){
   let columns,limit,filters=[];
   const q={select(c){assert.ok(!c.includes('*'));columns=c;return q;},eq(k,v){filters.push(['eq',k,v]);return q;},
   gte(k,v){filters.push(['gte',k,v]);return q;},lte(k,v){filters.push(['lte',k,v]);return q;},limit(n){limit=n;return q;},
   in(k,v){filters.push(['in',k,v]);return q;},order(){return q;},
   insert:forbidden,update:forbidden,upsert:forbidden,delete:forbidden,rpc:forbidden,
   then(ok,no){const log={table,columns,filters:structuredClone(filters)};reads.push(log);onQuery(data,log,reads.length);
     let selected=(data[table]||[]).filter(r=>filters.every(([op,k,v])=>op==='eq'?r[k]===v:op==='in'?v.includes(r[k]):op==='gte'?r[k]>=v:r[k]<=v));
     selected=selected.slice(0,limit).map(r=>Object.fromEntries(columns.split(',').map(k=>[k,r[k]])));
     return Promise.resolve({data:selected,error:null}).then(ok,no);}};return q;}};
 const snapshot=async()=>{const s={input:{id:id(10),waba_id:'1297760461811288',phone_number_id:'1198305790026665',
 native_message_id:'wamid.fixture',capture_reason:'captured',message_type:'text',observer_only:true,observer_state:'observed',sanitized_text:'¿Cuál es mi renta?'},
 enabled:true,scope_channel:'544519',checked_at:new Date(now()).toISOString(),mutated:false,later_scope_echoes:0,echo_assessments:[],later_scope_uncertain:0,
 identity:{state:'matched',reason:'exact_existing_canonical_phone',candidate_count:1,client_identity_id:id(1),authorizes_business:false}};
 snapshotChange(s,++snaps);return s;};
 const readers=createAdminShadowContextReaders({db,snapshot,inputId:id(10),now});
 return {data,readers,reads,writes,db,snapshot};
}
function integration(f,{afterModel=()=>{}}={}){
 const records=[],requests=[];let claimed=false;
 const env={OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna'};
 const store={snapshot:f.snapshot,async claim(){if(claimed)return false;claimed=true;return true;},async start(){return true;},async finish(r){records.push(r);}};
 const run=()=>runMetaAdminShadowOnceWithContext({db:f.db,inputId:id(10),authorizedInputId:id(10),store,env,now,
   async propose(context){const request=restrictedAdminRequest(context,env);requests.push(request);afterModel(f);
     return {provider:'openai',model:'gpt-6-luna',run_id:'intercepted-fixture',proposed_response:'Propuesta interceptada de fixture'};}});
 return {run,records,requests};
}
test('model boundary rejects private context for unmatched and blocked context',()=>{
 const env={OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna'};
 assert.throws(()=>restrictedAdminRequest({identity_state:'unmatched',admin_context:{state:'ready'}},env),/private_context_requires_matched/);
 assert.throws(()=>restrictedAdminRequest({identity_state:'matched',admin_context:{state:'blocked'}},env),/context_unavailable/);
});
test('model boundary strips extra fields even on insufficient context',()=>{
 const req=restrictedAdminRequest({identity_state:'matched',sanitized_text:'Consulta',admin_context:{state:'insufficient_context',private:'PRIVATE_SECRET',agreement:{monthly_amount:'999'}}},{OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna'});
 assert.deepEqual(JSON.parse(req.input).admin_context,{state:'insufficient_context',reason:'context_unavailable'});
});
test('integration: matched model input contains only certified rent/payment projection',async()=>{
 const f=fixture(),h=integration(f);const result=await h.run();
 assert.equal(result.status,'complete');assert.equal(result.model_calls,1);assert.equal(result.send_calls,0);
 const req=h.requests[0],text=JSON.stringify(req);assert.deepEqual(req.tools,[]);assert.equal(req.tool_choice,'none');
 assert.ok(text.includes('11000.00'));assert.ok(text.includes('2026-10'));assert.ok(text.includes('pagado'));
 for(const secret of [id(1),id(3),phone,'THIRD_PARTY','PRIVATE_','77777','owner_email'])assert.ok(!text.includes(secret),secret);
 assert.deepEqual(f.writes,[]);assert.ok(f.reads.every(q=>!q.table.includes('respond')));
 assert.equal((await h.run()).status,'already_claimed');assert.equal(h.requests.length,1);
});
test('integration: ambiguity prevents amount queries and asks clarification',async()=>{
 const f=fixture({kind:'owner',change(d){d.properties.push({...d.properties[0],id:id(20)});d.client_source_links.push({...d.client_source_links[0],source_id:id(20)});}}),h=integration(f);
 assert.equal((await h.run()).status,'complete');const text=JSON.stringify(h.requests[0]);
 assert.ok(text.includes('ambiguous'));assert.ok(!text.includes('11000'));assert.ok(!f.reads.some(q=>q.table==='payments'||q.columns.includes('monthly_rent')));assert.deepEqual(f.writes,[]);
});
test('integration: revoked relationship supplies no private context',async()=>{
 const f=fixture({change:d=>d.client_source_links[0].link_status='revoked'}),h=integration(f);
 assert.equal((await h.run()).status,'complete');const text=JSON.stringify(h.requests[0]);
 assert.ok(text.includes('insufficient_context'));assert.ok(!text.includes('11000'));assert.ok(!text.includes('property_'));assert.deepEqual(f.writes,[]);
});
test('integration: unmatched remains anonymous with zero context reads',async()=>{
 const f=fixture({snapshotChange:s=>s.identity={state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false}}),h=integration(f);
 assert.equal((await h.run()).status,'complete');const text=JSON.stringify(h.requests[0]);
 assert.ok(text.includes('unmatched'));assert.ok(!text.includes('admin_context'));assert.equal(f.reads.length,0);assert.deepEqual(f.writes,[]);
});
test('integration: unaccredited condominium fee is unavailable, never inferred',async()=>{
 const f=fixture({kind:'condo'}),h=integration(f);assert.equal((await h.run()).status,'complete');const text=JSON.stringify(h.requests[0]);
 assert.ok(text.includes('condominium_fee_source_unverified'));assert.ok(!text.includes('850.50'));
 assert.ok(!f.reads.some(q=>['cuotas_condominio','condominium_fees','payments'].includes(q.table)));assert.deepEqual(f.writes,[]);
});
test('integration: payment changes during model invalidate proposal without retry',async()=>{
 const f=fixture(),h=integration(f,{afterModel:f=>f.data.payments[0].amount='12000.00'});
 assert.equal((await h.run()).status,'invalidated');assert.equal(h.records.at(-1).reason,'context_changed');assert.equal(h.requests.length,1);assert.deepEqual(f.writes,[]);
});
test('integration: applicable human echo during model invalidates proposal',async()=>{
 let human=false;const f=fixture({snapshotChange(s){if(human){s.later_scope_echoes=1;s.echo_assessments=[{state:'same_subject'}];}}}),h=integration(f,{afterModel:()=>human=true});
 assert.equal((await h.run()).status,'invalidated');assert.equal(h.requests.length,1);assert.deepEqual(f.writes,[]);
});
test('integration: concurrent calls consume one claim and one intercepted model request',async()=>{
 const f=fixture(),h=integration(f);const results=await Promise.all([h.run(),h.run()]);
 assert.deepEqual(results.map(r=>r.status).sort(),['already_claimed','complete']);assert.equal(h.requests.length,1);assert.deepEqual(f.writes,[]);
});
for(const mode of ['matched','unmatched','ambiguous','revoked','condo','human-after','missing-db'])test(`operator integration: ${mode}`,async()=>{
 let human=false,calls=0,record=null,request;
 const f=fixture({kind:mode==='condo'?'condo':'tenant',change(d){
   if(mode==='revoked')d.client_source_links[0].link_status='revoked';
   if(mode==='ambiguous')d.contracts.push({...d.contracts[0],id:id(21)});
 },snapshotChange(s){
   if(mode==='unmatched')s.identity={state:'unmatched',reason:'no_exact_identity',candidate_count:0,authorizes_business:false};
   if(human){s.later_scope_echoes=1;s.echo_assessments=[{state:'same_subject'}];}
 }});
 const env={META_ADMIN_SHADOW_OPERATOR_SECRET:'synthetic-secret-for-local-tests-only',META_ADMIN_SHADOW_AUTHORIZED_INPUT_ID:id(10),
   OPENAI_API_KEY:'synthetic',OPENAI_ADMIN_AGENT_MODEL:'gpt-6-luna',SUPABASE_SERVICE_ROLE_KEY:'synthetic',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid'};
 const store={contextDb:mode==='missing-db'?undefined:f.db,snapshot:f.snapshot,async claim(a){if(record)return false;record=a;return true;},
   async start(){return true;},async finish(a){record={...record,...a};}};
 const handler=createShadowOnceOperator({env,makeStore:()=>store,run:a=>runMetaAdminShadowOnceWithContext({...a,now,propose:async context=>{
   calls++;request=restrictedAdminRequest(context,env);if(mode==='human-after')human=true;
   return {provider:'openai',model:env.OPENAI_ADMIN_AGENT_MODEL,run_id:'intercepted',proposed_response:'Propuesta de fixture'};
 }})});
 const invoke=async()=>{const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
   await handler({method:'POST',headers:{authorization:`Bearer ${env.META_ADMIN_SHADOW_OPERATOR_SECRET}`},body:{input_id:id(10)}},res);return res;};
 const res=await invoke();assert.equal(res.code,['human-after','missing-db'].includes(mode)?409:200);
 if(mode==='missing-db'){assert.equal(calls,0);assert.equal(res.body.proposed_response,null);}
 else {assert.equal(calls,1);const dto=JSON.parse(request.input);assert.deepEqual(request.tools,[]);
   if(mode==='matched')assert.equal(dto.admin_context.agreement.monthly_amount,'11000.00');
   if(mode==='unmatched'){assert.equal(dto.admin_context,undefined);assert.equal(f.reads.length,0);}
   if(mode==='ambiguous')assert.equal(dto.admin_context.state,'ambiguous');
   if(['revoked','condo'].includes(mode)){assert.equal(dto.admin_context.state,'insufficient_context');assert.equal(dto.admin_context.agreement,undefined);}
   if(mode==='human-after'){assert.equal(res.body.status,'invalidated');assert.equal(res.body.proposed_response,null);}
 }
 assert.deepEqual(f.writes,[]);assert.ok(f.reads.every(q=>!q.table.includes('respond')));
 await invoke();assert.equal(calls,mode==='missing-db'?0:1);
});
for(const kind of ['tenant','owner'])test(`${kind}: exact scope, minimal financial context, no third parties`,async()=>{
 const f=fixture({kind}),r=await prepareAdminShadowContext({readers:f.readers,sections:['agreement','charges']});
 assert.equal(r.state,'ready');assert.deepEqual(r.roles,[kind==='condo'?'condomino':kind]);
 assert.equal(r.agreement.monthly_amount,kind==='condo'?'850.50':'11000.00');assert.equal(r.charges.items.length,1);
 const text=JSON.stringify(r);for(const value of [phone,digest,id(1),id(90),'THIRD_PARTY','PRIVATE_','77777','99999','commission','email','receipt'])assert.ok(!text.includes(value),value);
 assert.deepEqual(f.writes,[]);assert.ok(f.reads.every(q=>!q.table.includes('respond')));
});
test('relationship reader does not read financial fields',async()=>{
 const f=fixture();assert.equal((await f.readers.readRelationships()).state,'ready');
 assert.ok(f.reads.every(q=>!['payments','cuotas_condominio'].includes(q.table)&&!q.columns.includes('monthly_rent')));
});
test('no identity/property/SQL arguments accepted',async()=>{
 const f=fixture();assert.equal((await f.readers.readCharges({contractId:id(99),sql:'select *'})).state,'blocked');assert.equal(f.reads.length,0);
});
for(const kind of ['unmatched','ambiguous'])test(`${kind} cannot access context`,async()=>{
 const f=fixture({snapshotChange(s){s.identity={state:kind,reason:'no_exact_identity',candidate_count:0,authorizes_business:false};}});
 assert.notEqual((await f.readers.readAgreement()).state,'ready');assert.equal(f.reads.length,0);
});
for(const [name,fn] of [['revoked identity',d=>d.client_identities[0].revoked_at='2026-10-01'],
 ['revoked role',d=>d.client_identity_roles[0].status='revoked'],['revoked source',d=>d.client_source_links[0].link_status='revoked'],
 ['missing canonical source',d=>d.client_source_links=[]],['wrong tenant',d=>d.contracts[0].tenant_client_id=id(90)],
 ['expired contract',d=>d.contracts[0].end_date='2026-10-07'],['future contract',d=>d.contracts[0].start_date='2026-10-10'],
 ['invalid date',d=>d.contracts[0].end_date='2026-02-30'],['missing property FK',d=>d.contracts[0].property_id=null],
 ['unknown property status',d=>d.properties[0].status='unknown'],['null amount',d=>d.contracts[0].monthly_rent=null],
 ['negative amount',d=>d.contracts[0].monthly_rent=-1]])test(name,async()=>{
 const f=fixture({change:fn});const r=await f.readers.readAgreement();assert.equal(r.state,'insufficient_context');assert.ok(!r.agreement);assert.deepEqual(f.writes,[]);
});
test('owner FK must match canonical identity',async()=>{
 const f=fixture({kind:'owner',change:d=>d.properties[0].owner_client_id=id(90)});assert.equal((await f.readers.readAgreement()).state,'insufficient_context');
});
test('multiple properties => ambiguous before money query',async()=>{
 const f=fixture({kind:'owner',change(d){d.properties.push({...d.properties[0],id:id(20)});d.client_source_links.push({...d.client_source_links[0],source_id:id(20)});}});
 assert.equal((await f.readers.readCharges()).state,'ambiguous');assert.ok(!f.reads.some(r=>r.table==='payments'));
});
test('multiple current contracts => ambiguous',async()=>{
 const f=fixture({kind:'owner',change:d=>d.contracts.push({...d.contracts[0],id:id(21)})});assert.equal((await f.readers.readAgreement()).state,'ambiguous');
});
test('multiple units => ambiguous',async()=>{
 const f=fixture({kind:'condo',change(d){d.unidades_condominio.push({...d.unidades_condominio[0],id:id(24)});d.client_source_links.push({...d.client_source_links[0],source_id:id(24)});}});
 assert.equal((await f.readers.readCharges()).state,'ambiguous');assert.ok(!f.reads.some(r=>r.table==='cuotas_condominio'));
});
for(const [name,fn] of [['owner version',d=>d.unidades_condominio[0].identity_owner_version=2],['condominium scope',d=>d.client_source_links[0].condominium_id=id(99)],
 ['phone evidence',d=>d.unidades_condominio[0].propietario_telefono='525550100099'],['inactive unit',d=>d.unidades_condominio[0].activo=false]])
 test(`condo ${name} invalid`,async()=>{const f=fixture({kind:'condo',change:fn});assert.equal((await f.readers.readAgreement()).state,'insufficient_context');});
test('condo canonical 521 phone supported without disclosure',async()=>{
 const f=fixture({kind:'condo',change:d=>d.unidades_condominio[0].propietario_telefono='5215550100001'});assert.equal((await f.readers.readRelationships()).state,'ready');
});
test('no charge records is not paid or zero balance',async()=>{
 const f=fixture({change:d=>d.payments=[]});const r=await f.readers.readCharges();assert.equal(r.state,'insufficient_context');assert.equal(r.reason,'charges_unavailable');
});
test('unknown payment status withheld',async()=>{
 const f=fixture({change:d=>d.payments[0].status='maybe_paid'});assert.equal((await f.readers.readCharges()).state,'insufficient_context');
});
test('bounded result overflow cannot silently truncate',async()=>{
 const f=fixture({change:d=>d.payments=Array.from({length:51},()=>({...d.payments[0]}))});assert.equal((await f.readers.readCharges()).reason,'source_limit_exceeded');
});
test('source read failure sanitized',async()=>{
 const f=fixture({onQuery(){throw Error('private/secret');}});assert.deepEqual(await f.readers.readAgreement(),{state:'insufficient_context',reason:'source_read_failed'});
});
test('relationship revoked during reading returns no context',async()=>{
 const f=fixture({onQuery(d,q){if(q.table==='payments')d.client_source_links[0].link_status='revoked';}});assert.equal((await f.readers.readCharges()).state,'insufficient_context');
});
test('financial value changes between reads withheld',async()=>{
 let reads=0;const f=fixture({onQuery(d,q){if(q.columns.includes('monthly_rent')&&++reads===2)d.contracts[0].monthly_rent='999';}});
 assert.equal((await f.readers.readAgreement()).reason,'context_changed');
});
for(const state of ['same_subject','unknown','conflict'])test(`echo ${state} blocks before DB`,async()=>{
 const f=fixture({snapshotChange(s){s.later_scope_echoes=1;s.echo_assessments=[{state}];}});assert.equal((await f.readers.readAgreement()).state,'blocked');assert.equal(f.reads.length,0);
});
test('other_subject does not block',async()=>{
 const f=fixture({snapshotChange(s){s.later_scope_echoes=1;s.echo_assessments=[{state:'other_subject'}];}});assert.equal((await f.readers.readAgreement()).state,'ready');
});
for(const [name,fn] of [['edit/revoke',s=>s.mutated=true],['stale snapshot',s=>s.checked_at=new Date(now()-5001).toISOString()]])
 test(name,async()=>{const f=fixture({snapshotChange:fn});assert.equal((await f.readers.readAgreement()).state,'blocked');assert.equal(f.reads.length,0);});
test('human evidence arrives mid-read => no context',async()=>{
 const f=fixture({snapshotChange(s,n){if(n>1){s.later_scope_echoes=1;s.echo_assessments=[{state:'same_subject'}];}}});assert.equal((await f.readers.readAgreement()).state,'blocked');
});
test('identity changes mid-read => no context',async()=>{
 const f=fixture({snapshotChange(s,n){if(n>1)s.identity.client_identity_id=id(91);}});assert.notEqual((await f.readers.readAgreement()).state,'ready');
});
test('unsupported sections fail closed',async()=>{
 const f=fixture();assert.equal((await prepareAdminShadowContext({readers:f.readers,sections:['private_tools']})).state,'blocked');assert.equal(f.reads.length,0);
});
test('integration: readers isolated; endpoint uses authenticated context composition',()=>{
 const source=readFileSync(new URL('../lib/messaging/metaAdminCapture/shadowContextReadOnly.js',import.meta.url),'utf8');
 assert.ok(!/\.(insert|upsert|delete|rpc)\s*\(/.test(source));
 assert.equal((source.match(/\.update\(/g)||[]).length,0);
 assert.ok(!source.includes('.from('));
 assert.ok(!/\bfetch\s*\(/.test(source));
 for(const file of ['shadowOnce.js','shadowOnceOperator.js','shadowOnceSelfInvoke.js'])
 assert.ok(!readFileSync(new URL(`../lib/messaging/metaAdminCapture/${file}`,import.meta.url),'utf8').includes('shadowContextReadOnly'));
 const operator=readFileSync(new URL('../lib/messaging/metaAdminCapture/shadowOnceOperator.js',import.meta.url),'utf8');
 assert.ok(operator.includes('run=runMetaAdminShadowOnceWithContext'));
 assert.ok(operator.includes('db:store.contextDb'));
 const endpoint=readFileSync(new URL('../pages/api/operaciones/meta-admin-shadow-once.js',import.meta.url),'utf8');
 assert.ok(endpoint.includes('contextDb:client'));
});
for(const kind of ['tenant','owner','condo'])test(`${kind}: Respond and Meta use identical canonical context`,async()=>{
 const f=fixture({kind});
 const meta=await prepareAdminShadowContext({readers:f.readers,sections:kind==='condo'?[]:['agreement','charges']});
 assert.ok(f.reads.every(r=>!r.table.includes('respond')));
 const respond=await prepareAdminShadowContext({readers:createRespondCanonicalContextReaders({db:f.db,respondContactId:'fixture-contact',now}),
 sections:kind==='condo'?[]:['agreement','charges']});
 assert.equal(meta.state,'ready');assert.deepEqual(respond,meta);assert.deepEqual(f.writes,[]);
});
test('unaccredited condominium money sources are never queried or inferred',async()=>{
 const f=fixture({kind:'condo'});
 for(const method of ['readAgreement','readCharges'])assert.deepEqual(await f.readers[method](),{state:'insufficient_context',reason:'condominium_fee_source_unverified'});
 assert.ok(f.reads.every(r=>!['condominium_fees','cuotas_condominio'].includes(r.table)&&!r.columns.includes('cuota_mensual')));
});
test('legacy tool calls retain their fields and five-row limit',async()=>{
 const f=fixture({change(d){d.contracts[0].end_date='2020-01-01';d.payments=Array.from({length:8},(_,i)=>({...d.payments[0],id:id(60+i)}));}});
 const contracts=await shadowContextTools.find_active_contracts(f.db,{contractId:id(3)});
 assert.equal(contracts.length,1);assert.equal(contracts[0].monthlyRent,undefined);
 const payments=await shadowContextTools.get_payment_summary(f.db,{contractId:id(3)});assert.equal(payments.length,5);
 assert.equal(payments[0].contractId,undefined);
});
test('server options are not accepted in model tool schemas',()=>{
 assert.throws(()=>validateShadowToolArguments('find_active_contracts',{contractId:id(3),includeRent:true}));
 assert.throws(()=>validateShadowToolArguments('get_payment_summary',{contractId:id(3),period:'2026-10'}));
});
test('monthly option does not truncate to legacy five-row limit',async()=>{
 const f=fixture({change:d=>d.payments=Array.from({length:8},()=>({...d.payments[0]}))});
 const r=await f.readers.readCharges();assert.equal(r.state,'ready');assert.equal(r.charges.items.length,8);
});
test('tenant multiple current contracts blocked before any amount',async()=>{
 const f=fixture({change(d){d.contracts.push({...d.contracts[0],id:id(22)});d.client_source_links.push({...d.client_source_links[0],source_id:id(22)});}});
 assert.equal((await f.readers.readAgreement()).state,'ambiguous');assert.ok(f.reads.every(r=>!r.columns.includes('monthly_rent')));
});
test('foreign property is never consulted via supplied reader arguments',async()=>{
 const f=fixture();for(const method of ['readRelationships','readAgreement','readCharges'])assert.equal((await f.readers[method]({propertyId:id(90)})).state,'blocked');
 assert.equal(f.reads.length,0);
});
test('unlinked second active tenant contract still blocks amounts',async()=>{
 const f=fixture({change:d=>d.contracts.push({...d.contracts[0],id:id(22)})});
 assert.equal((await f.readers.readAgreement()).state,'ambiguous');
 assert.ok(f.reads.every(r=>!r.columns.includes('monthly_rent')&&r.table!=='payments'));
});
test('revoked relationship denied equally through Respond and Meta',async()=>{
 const f=fixture({change:d=>d.client_source_links[0].link_status='revoked'});
 const meta=await f.readers.readAgreement();
 const respond=await createRespondCanonicalContextReaders({db:f.db,respondContactId:'fixture-contact',now}).readAgreement();
 assert.deepEqual(respond,meta);assert.notEqual(meta.state,'ready');assert.deepEqual(f.writes,[]);
});
test('new core contains no write path or transport calls',()=>{
 const source=readFileSync(new URL('../lib/shadow/canonicalReadOnlyContext.js',import.meta.url),'utf8');
 assert.ok(!/\.(insert|upsert|delete|rpc)\s*\(/.test(source));
 assert.equal((source.match(/\.update\(/g)||[]).length,1);
 assert.ok(source.includes("createHash('sha256').update(JSON.stringify(x))"));
 assert.ok(!/\bfetch\s*\(/.test(source));
});
