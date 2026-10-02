// DEV-only integration harness. The caller supplies an in-memory service client pinned
// to hjfwjnejbcpmknvfpdcq and a deny-by-default network interceptor. No env loading,
// migration, real provider or Respond request; no cleanup outside the recorded fixture.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { captureSocialRoute } from '../lib/social/routing.js';
import { processSocialRouteImmediate } from '../lib/social/immediate.js';
import { resolveSocialAppointmentClient } from '../lib/social/appointmentIdentity.js';
import { readSocialAppointment, socialAssignmentBarrier } from '../lib/social/continuity.js';
import { readSocialSalesContext, socialSalesOutput } from '../lib/social/salesInventory.js';
import { SOCIAL_CTA_CLARIFICATION, SOCIAL_INVENTORY_CLARIFICATION } from '../lib/social/commercialIntent.js';
import { sanitizeShadowText } from '../lib/shadow/coordinator.js';
import * as handoffs from '../lib/agentsV2/salesHandoff.js';
import { createAndDispatchLegalHandoff } from '../lib/agentsV2/legalHandoff.js';
import { executeSalesTool } from '../lib/agentsV2/openaiSalesAgent.js';
import { captureRespondSalesV2InboundIsolated } from '../lib/agentsV2/salesCapture.js';
import { captureRespondLegalInboundIsolated } from '../lib/agentsV2/legalCapture.js';
import { captureRespondOwnerInboundIsolated } from '../lib/agentsV2/ownerCapture.js';
import { decideRespondMessageRoute, resolveRespondChannelRouterConfig } from '../lib/respond/channelRouter.js';
import { importWithStubs } from '../tests/helpers/socialFixtures.mjs';

const day1='2026-09-30T16:00:00.000Z',day2='2026-10-01T14:00:00.000Z',appointmentAt='2026-10-01T16:30:00.000Z';
const forbidden=async()=>{throw Error('unexpected_external_model_or_tool');};
const usage={safeAgentUsage:async()=>({inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,estimatedCostUsd:0})};
const need=async(query)=>{const r=await query;if(r.error)throw Object.assign(Error('dev_database_operation_failed'),{code:r.error.code});return r.data;};
const tables={SALES:'sales_agent_v2_inbound_messages',OWNER:'owner_agent_v1_inbound_messages',LEGAL:'legal_agent_v1_inbound_messages'};

export async function certify(admin,state,emit){
 assert.equal(state.project,'hjfwjnejbcpmknvfpdcq');
 assert.equal(String(admin.supabaseUrl).replace(/\/$/,''),'https://hjfwjnejbcpmknvfpdcq.supabase.co');
 assert.notEqual(process.env.SOCIAL_ROUTING_V1_ENABLED,'true');
 const tag='social-dev-cert-'+randomBytes(6).toString('hex'),reports=[],ops=[],inventory={project:state.project,tag,actors:[],clients:[],properties:[],opportunities:[],contacts:[],events:[]};
 state.inventories??=[];state.inventories.push(inventory);
 const save=()=>writeFile(state.dir+'/inventory.json',JSON.stringify(state.inventories,null,2),{mode:0o600});
 let lastCheck=null;
 const check=(name,ok)=>{lastCheck=name;assert.ok(ok,name);reports.push({name,result:'PASS'});emit(reports.at(-1));};
 const group=async(name,fn)=>{lastCheck=null;try{await fn();}catch(e){reports.push({name,result:'FAIL',check:lastCheck,code:e.code||null,error:e.name==='AssertionError'?'assertion_failed':/^[a-zA-Z0-9_]+$/.test(e.message)?e.message:'harness_exception'});emit(reports.at(-1));throw Error('certification_stopped_after_first_failure');}};
 const db=new Proxy(admin,{get(target,key){if(key==='from')return table=>{const q=target.from(table);return new Proxy(q,{get(t,k){if(['select','insert','upsert','update','delete'].includes(k))return(...args)=>{ops.push({table,operation:k});return t[k](...args);};return typeof t[k]==='function'?t[k].bind(t):t[k];}});};if(key==='rpc')return(name,args)=>{ops.push({table:name,operation:'rpc'});return target.rpc(name,args);};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
 // ON is a per-invocation fixture option, never process.env or a hosted variable.
 const enabled={SOCIAL_ROUTING_V1_ENABLED:'true'};
 const env={SOCIAL_ROUTING_V1_ENABLED:'false',SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:'false',RESPOND_IO_TOKEN:'synthetic-only',SALES_AGENT_V2_HANDOFF_WORKFLOW_URL:'https://hooks.respond.io/synthetic-social-dev-sales',LEGAL_AGENT_V1_HANDOFF_WORKFLOW_URL:'https://hooks.respond.io/synthetic-social-dev-legal',OPENAI_OWNER_AGENT_MODEL:'synthetic',OPENAI_LEGAL_AGENT_MODEL:'synthetic'};
 let seq=0;
 const contact=(suffix)=>{const c=tag+'-'+suffix;if(!inventory.contacts.includes(c))inventory.contacts.push(c);return c;};
 const makeEvent=async(c,channel='497382',at=day2)=>{
  const event={eventType:'message.received',eventId:tag+'-e'+(++seq),messageId:tag+'-m'+seq,respondContactId:c,channelId:channel,eventOccurredAt:at};
  inventory.events.push(event.eventId);await save();
  await need(db.from('gv_respond_webhook_events').insert({event_id:event.eventId,event_type:event.eventType,respond_contact_id:c,message_id:event.messageId,event_occurred_at:at,status:'processed',processed_at:new Date().toISOString(),payload_meta:{synthetic_certification:true}}));
  return event;
 };
 const capture=async(text,c,channel='497382',at=day2,source)=>{const event=await makeEvent(c,channel,at);return captureSocialRoute(db,{message:{text},...(source?{source}:{})},event,{env:enabled});};
 const row=async(table,id)=>need(db.from(table).select('*').eq('id',id).single());
 const readContact=async(table,c,select='*')=>need(db.from(table).select(select).eq('respond_contact_id',c));
 const snapshot=async(c,patch={})=>need(db.from('gv_respond_contact_snapshots').insert({respond_contact_id:c,respond_channel_id:'498219',respond_record_active:true,metadata:{mapping_method:'current_assignee_unassigned'},...patch}));
 const externalBefore=state.mocks.length;
 let advisor,client,property,ownerContact,appointmentModule;
 await save();
 try {
  await group('fixtures_and_mapping',async()=>{
   check('no_existing_pending_sync',(await need(db.from('respond_appointment_sync').select('id').eq('status','pending').limit(1))).length===0);
   check('synthetic_listing_no_collision',(await need(db.from('propiedades').select('id').eq('public_id','EMP-MUN7BHJX'))).length===0);
   const email=tag+'@example.invalid';
   const created=await need(admin.auth.admin.createUser({email,password:randomBytes(30).toString('base64url')+'aA1!',email_confirm:true}));
   advisor=created.user.id;inventory.actors.push(advisor);await save();
   await need(db.from('profiles').update({role_id:'asesor',active:true,full_name:'Asesor Sintético DEV'}).eq('id',advisor));
   client=randomUUID();inventory.clients.push(client,randomUUID());property=randomUUID();inventory.properties.push(property);await save();
   await need(db.from('clientes').insert(inventory.clients.map(id=>({id,nombre:'Homónimo Sintético DEV',asesor_id:advisor}))));
   await need(db.from('propiedades').insert({id:property,public_id:'EMP-MUN7BHJX',titulo:'Casa en Venta en Chapulco, Puebla | 3 Recámaras y Vista a la Laguna',status:'published',operacion:'sale',tipo:'Casa',precio:1800000,moneda:'MXN',recamaras:3,colonia:'Chapulco',ciudad:'Puebla',direccion:'Ubicación sintética DEV'}));
   const work=await import('../lib/ejecutivo/workCenter.js');
   const {buildRespondSnapshot}=await importWithStubs(new URL('../lib/ejecutivo/respondSync.js',import.meta.url),{'./workCenter':work});
   const profile=await row('profiles',advisor);ownerContact=contact('owner');
   const mapped=buildRespondSnapshot({contact:{id:ownerContact,status:'open',lifecycle:'Visita agendada',assignee:{id:tag+'-advisor',email}},profiles:[profile],messages:[],existingSnapshot:{mapped_profile_id:randomUUID(),respond_channel_id:'498219'}});
   check('current_human_assignment_overrides_old_snapshot',mapped.mapped_profile_id===advisor&&mapped.mapping_status==='matched');
   await need(db.from('gv_respond_contact_snapshots').insert(mapped));
   const stored=(await readContact('gv_respond_contact_snapshots',ownerContact))[0];
   check('Respond_to_advisor_mapping_persisted',stored.mapped_profile_id===advisor&&stored.respond_assignee_id===tag+'-advisor');
   const opp=randomUUID();inventory.opportunities.push(opp);await save();
   await need(db.from('gv_opportunities').insert({id:opp,title:tag,asesor_id:advisor,cliente_id:client,propiedad_id:property,respond_contact_id:ownerContact}));
   check('same_name_never_joins',(await resolveSocialAppointmentClient(db,contact('homonym-unlinked'))).clientId===null);
   check('explicit_contact_link_only',(await resolveSocialAppointmentClient(db,ownerContact)).clientId===client);
  });
  await group('routing_matrix_and_idempotence',async()=>{
   for(const [name,text,channel,destination] of [
    ['instagram','Busco casa en renta','497382','SALES'],['messenger','Quiero comprar departamento','515318','SALES'],['owner','Soy propietario, quiero vender mi casa','497382','OWNER'],['legal','Qué incluye la póliza jurídica','515318','LEGAL'],['administration','Consulta sobre mantenimiento del condominio','497382','ADMINISTRATION'],['complaint','Tengo una queja sobre mi inmueble','497382','HUMAN_REVIEW'],['unknown','Hola','497382','UNKNOWN'],['existing','Ya soy cliente','515318','EXISTING_CLIENT'],
   ]){
    const c=contact(name),r=await capture(text,c,channel),saved=await row('social_message_routes',r.routeId);
    check(name+'_one_persisted_destination',r.created===true&&r.destination===destination&&saved.destination===destination&&saved.source_channel_id===channel);
    const counts=await Promise.all(Object.values(tables).map(t=>readContact(t,c,'id')));
    check(name+'_exclusive_queue',counts.reduce((n,a)=>n+a.length,0)===(tables[destination]?1:0));
    if(!tables[destination])check(name+'_no_specialist', (await processSocialRouteImmediate(db,r,new Proxy({},{get(){throw Error('unexpected_specialist');}}))).status==='requires_human_review');
   }
   const c=contact('duplicate'),event=await makeEvent(c),body={message:{text:'Busco casa'},source:{post_id:'post-synthetic',comment_id:'comment-synthetic',ad_id:'ad-synthetic',campaign_id:'campaign-synthetic',property_id:'EMP-MUN7BHJX',metadata:{origin_kind:'private_reply',media_type:'text'}}};
   const routes=await Promise.all([captureSocialRoute(db,body,event,{env:enabled}),captureSocialRoute(db,body,event,{env:enabled})]);
   check('concurrent_event_one_route',routes.filter(r=>r.created).length===1&&(await readContact('social_message_routes',c)).length===1);
   check('concurrent_event_one_queue',(await readContact(tables.SALES,c)).length===1);
   const saved=(await readContact('social_message_routes',c))[0];
   check('explicit_social_attribution_preserved',saved.source_post_id==='post-synthetic'&&saved.source_comment_id==='comment-synthetic'&&saved.source_ad_id==='ad-synthetic'&&saved.source_campaign_id==='campaign-synthetic'&&saved.source_property_id===property&&saved.source_metadata.origin_kind==='private_reply');
   const missing=(await readContact('social_message_routes',contact('instagram')))[0];
   check('absent_attribution_remains_null',['post','comment','ad','campaign','property'].every(k=>missing['source_'+k+'_id']===null)&&missing.source_metadata===null);
   const denied=await db.from(tables.OWNER).insert({event_id:event.eventId+'-cross',external_message_id:event.messageId,respond_contact_id:c,channel_id:event.channelId,occurred_at:day2,sanitized_text:'synthetic',social_route_id:saved.id,status:'captured'});
   check('cross_agent_insert_rejected',Boolean(denied.error));
  });
  await group('appointments_and_concurrency',async()=>{
   assert.ok(advisor&&client&&property&&ownerContact);
   appointmentModule=await importWithStubs(new URL('../lib/agentsV2/respondAppointmentSync.js',import.meta.url),{'../ejecutivo/respondSync.js':{fetchRespondContact:forbidden,readRespondMessages:async()=>({messages:[{at:day1,text:'Visita acordada mañana a las 10:30',traffic:'outgoing',sender:{source:'user'}}]}),respondMessageTimestamp:m=>m.at}});
   const body={event_type:'contact.lifecycle.updated',event_id:tag+'-initial-sync',contact:{id:ownerContact,lifecycle:{name:'Visita agendada'}},channelId:'498219'};
   check('appointment_capture_real',(await appointmentModule.captureRespondAppointmentLifecycleIsolated(db,body,{env:enabled})).status==='captured');
   check('appointment_event_duplicate',(await appointmentModule.captureRespondAppointmentLifecycleIsolated(db,body,{env:enabled})).status==='duplicate');
   const clock=Date.now;Date.now=()=>new Date(day1).getTime();let result;
   try{result=await appointmentModule.processOneRespondAppointmentSync(db);}finally{Date.now=clock;}
   check('day1_relative_date_committed',result.status==='created'&&(await readSocialAppointment(db,ownerContact)).appointment?.fecha_hora&&new Date((await readSocialAppointment(db,ownerContact)).appointment.fecha_hora).toISOString()===appointmentAt);
   const concurrentContact=contact('booking-race'),concurrentClient=inventory.clients[1],concurrentOpp=randomUUID();
   inventory.opportunities.push(concurrentOpp);await save();
   await need(db.from('gv_opportunities').insert({id:concurrentOpp,title:tag+' booking race',asesor_id:advisor,cliente_id:concurrentClient,propiedad_id:property,respond_contact_id:concurrentContact}));
   check('concurrent_booking_starts_without_cita',(await need(db.from('citas').select('id').eq('cliente_id',concurrentClient))).length===0);
   const syncs=[];for(let i=0;i<2;i++)syncs.push((await need(db.from('respond_appointment_sync').insert({event_id:tag+'-concurrent-'+i,respond_contact_id:concurrentContact,lifecycle:'Visita agendada',social_routing_version:1,status:'pending'}).select('id').single())).id);
   const concurrent=await Promise.all(syncs.map(id=>need(db.rpc('commit_social_appointment_v1',{p_sync_id:id,p_advisor_id:advisor,p_client_id:concurrentClient,p_property_id:property,p_at:appointmentAt,p_source_at:day1,p_excerpt:'Confirmación sintética DEV'}))));
   check('two_connections_same_cita',new Set(concurrent.map(x=>x.citaId)).size===1&&concurrent.filter(x=>x.status==='created').length===1);
   check('exactly_one_concurrent_cita',(await need(db.from('citas').select('id').eq('cliente_id',concurrentClient).eq('propiedad_id',property))).length===1);
   check('sync_grant_updates_real',(await readContact('respond_appointment_sync',ownerContact)).every(x=>x.status==='created'));
  });
  await group('Mika_equivalent_durable_OWNER',async()=>{
   assert.equal((await readSocialAppointment(db,ownerContact)).status,'confirmed');
   const before=JSON.stringify([await readContact('gv_respond_contact_snapshots',ownerContact),await need(db.from('citas').select('*').eq('cliente_id',client))]);
   await capture('Soy propietaria, quiero vender mi casa',ownerContact,'498219',day1);
   await capture('mañana te mando ubicación',ownerContact,'498219','2026-09-30T18:00:00.000Z');
   const inputs=[],start=state.mocks.length;
   const owner=await importWithStubs(new URL('../lib/agentsV2/processOwnerInbound.js',import.meta.url),{
    '../ejecutivo/respondSync':{readRespondMessages:async()=>({messages:[{at:day1,traffic:'outgoing',text:'Visita acordada mañana a las 10:30'}]}),respondMessageTimestamp:m=>m.at},
    '../shadow/coordinator':{sanitizeShadowText},'./agentUsage':usage,
    './openaiOwnerAgent':{createOwnerSession:async({input})=>{inputs.push(input);return{id:tag+'-owner-session-'+inputs.length};},getOwnerSession:async id=>({id,status:'idle'}),fulfillOwnerActions:forbidden,ownerOutput:async()=> 'Gracias, nos vemos mañana a las 10:30.'},
   });
   for(const [text,at] of [['Buenos días te mando la dirección de mi casa',day2],['Calle Sintética 100 col Prueba','2026-10-01T14:01:00.000Z']]){
    const r=await capture(text,ownerContact,'498219',at);check('next_day_stays_OWNER_'+at,r.destination==='OWNER');
    check('owner_processor_service_writes_'+at,(await owner.processOwnerInboundById(db,r.inboundId,{env})).status==='sent');
    const inbound=await row(tables.OWNER,r.inboundId);
    check('owner_detail_context_preserved_'+at,inbound.sanitized_text===text);
    check('no_owner_sales_fallback_'+at,(await handoffs.createSalesAutomationFallbackHandoff(db,{inbound,env})).created===false);
    check('no_owner_sales_handoff_'+at,(await handoffs.createSalesHandoffIfNeeded(db,{inbound,env})).created===false);
   }
   const sent=state.mocks.slice(start);
   check('OWNER_no_assignment_or_ACK',sent.length===2&&sent.every(m=>m.kind==='message'&&!/asign|asesor/i.test(m.body.message.text)));
   check('appointment_not_shifted_in_messages',sent.every(m=>/01\/10\/2026 a las 10:30/.test(m.body.message.text)&&!/mañana|02\/10/.test(m.body.message.text)));
   check('historical_relative_text_anchored',inputs.length===2&&inputs.every(x=>/01\/10\/2026 a las 10:30/.test(x)&&!/mañana/.test(x)));
   check('advisor_and_appointment_unchanged',before===JSON.stringify([await readContact('gv_respond_contact_snapshots',ownerContact),await need(db.from('citas').select('*').eq('cliente_id',client))]));
   check('OWNER_zero_Sales_rows',(await readContact(tables.SALES,ownerContact)).length===0&&(await readContact('sales_agent_v2_handoffs',ownerContact)).length===0);
   const runs=await need(db.from('owner_agent_v1_runs').select('id').in('inbound_message_id',(await readContact(tables.OWNER,ownerContact)).map(x=>x.id)));
   check('owner_runs_outbound_readback',runs.length===2&&(await readContact('owner_agent_v1_auto_outbound',ownerContact)).every(x=>x.status==='sent'));
  });
  await group('CTA_and_vendor',async()=>{
   const c=contact('cta'),r=await capture('El conde',c),inbound=await row(tables.SALES,r.inboundId),start=state.mocks.length;
   const runner=await importWithStubs(new URL('../lib/agentsV2/runSalesShadowMessage.js',import.meta.url),{
    './openaiSalesAgent':{assertSalesAgentV2ShadowEnvironment:()=>{},createSalesSession:forbidden,getSalesSession:forbidden,fulfillSalesActions:forbidden,salesSessionItems:forbidden,salesAssistantOutput:forbidden},
    '../ejecutivo/respondSync':{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:m=>m.at},'../shadow/coordinator':{sanitizeShadowText},
   });
   const sales=await importWithStubs(new URL('../lib/agentsV2/processSalesInbound.js',import.meta.url),{'./runSalesShadowMessage':runner,'./salesHandoff':handoffs,'./salesAutoOutbound':{processSalesAutoOutboundRun:forbidden},'./agentUsage':usage,'./openaiSalesAgent':{salesAgentModel:forbidden}});
   check('CTA_processed_policy_only',(await sales.processSalesInboundById(db,inbound.id,{env})).status==='processed');
   check('CTA_duplicate_atomic_claim',(await sales.processSalesInboundById(db,inbound.id,{env})).status==='not_claimed');
   const runs=await need(db.from('sales_agent_v2_shadow_runs').select('*').eq('inbound_message_id',inbound.id));
   check('CTA_one_safe_clarification_no_model',runs.length===1&&runs[0].model===null&&runs[0].proposed_response===SOCIAL_CTA_CLARIFICATION);
   check('CTA_no_fallback',(await handoffs.createSalesAutomationFallbackHandoff(db,{inbound,env})).created===false);
   check('CTA_zero_handoff_assignment_ACK',(await readContact('sales_agent_v2_handoffs',c)).length===0&&state.mocks.length===start);
   const vendor=contact('vendor'),text='Ofrezco servicios audiovisuales con drones para mostrar mejor los espacios',v=await capture(text,vendor);
   check('vendor_HUMAN_REVIEW',v.destination==='HUMAN_REVIEW'&&v.inboundId===null);
   const legacy={respond_contact_id:vendor,channel_id:'497382',social_route_id:v.routeId,sanitized_text:text};
   check('vendor_no_handoff',(await handoffs.createSalesHandoffIfNeeded(db,{inbound:legacy,env})).created===false);
   check('vendor_no_fallback_assignment_ACK',(await handoffs.createSalesAutomationFallbackHandoff(db,{inbound:legacy,env})).created===false&&state.mocks.length===start);
  });
  await group('Chapulco_real_PostgREST',async()=>{
   const args={zone:'atrás de la laguna de Chapulco',operation:'sale',propertyType:'Casa'},messageText='Hola me puedes dar inf de una casa que indicas está atrás de la laguna de chapulco';
   check('legacy_full_phrase_false_negative_reproduced',(await executeSalesTool(db,'search_sales_inventory',args)).length===0);
   const found=await executeSalesTool(db,'search_sales_inventory',args,{socialContext:{messageText}});
   check('social_text_finds_published_listing',found.listings.some(x=>x.publicId==='EMP-MUN7BHJX'&&x.price===1800000)&&found.sourceConfirmed===false);
   const c=contact('source'),route=await capture('El conde',c,'497382',day2,{property_id:'EMP-MUN7BHJX'}),inbound=await row(tables.SALES,route.inboundId),context=await readSocialSalesContext(db,inbound,env);
   check('CTA_verified_attribution_used',context.sourcePropertyId===property&&(await row('social_message_routes',route.routeId)).reason==='verified_property_context');
   const sourced=await executeSalesTool(db,'search_sales_inventory',{zone:'otra zona'},{socialContext:context});
   check('verified_source_precedes_text',sourced.sourceConfirmed===true&&sourced.listings[0]?.publicId==='EMP-MUN7BHJX');
   check('source_respects_budget',(await executeSalesTool(db,'search_sales_inventory',{maxPrice:1000000},{socialContext:context})).listings.length===0);
   check('coverage_uses_real_published_evidence',(await executeSalesTool(db,'check_sales_coverage',{location:args.zone},{socialContext:{}}))[0].covered===true);
   check('empty_query_not_inventory_absence',socialSalesOutput('No me aparecen casas publicadas.',{messageText})===SOCIAL_INVENTORY_CLARIFICATION);
  });
  await group('assignment_ACK_concurrent_reservations',async()=>{
   const c=contact('handoff');await snapshot(c);
   const r=await capture('Quiero visitar la casa',c),inbound=await row(tables.SALES,r.inboundId);
   const created=await handoffs.createSalesHandoffIfNeeded(db,{inbound,env});check('unassigned_handoff_created',created.created===true);
   const start=state.mocks.length;
   await Promise.allSettled([handoffs.dispatchSalesHandoff(db,{handoffId:created.handoffId,env}),handoffs.dispatchSalesHandoff(db,{handoffId:created.handoffId,env})]);
   await handoffs.dispatchSalesHandoff(db,{handoffId:created.handoffId,env});
   const effects=state.mocks.slice(start),saved=await row('sales_agent_v2_handoffs',created.handoffId);
   check('one_workflow_request',effects.filter(x=>x.kind==='workflow').length===1);
   check('one_separate_ACK',effects.filter(x=>x.kind==='message').length===1);
   check('assignment_and_ACK_persisted',saved.status==='assignment_requested'&&saved.assignment_requested_at&&saved.ack_sent_at&&saved.ack_message_id);
   const reservations=await need(db.from('social_handoff_effects').select('*').eq('handoff_id',created.handoffId));
   check('two_effect_receipts',reservations.length===2&&reservations.every(x=>x.status==='completed'));
   const assigned=contact('assigned');await snapshot(assigned,{mapped_profile_id:advisor,respond_assignee_id:tag+'-advisor',mapping_status:'matched'});
   const ar=await capture('Quiero visitar la casa',assigned),ai=await row(tables.SALES,ar.inboundId),old=state.mocks.length;
   check('current_responsible_barrier',await socialAssignmentBarrier(db,ai,{env})==='existing_responsible_preserved');
   check('current_responsible_no_assignment',(await handoffs.createSalesHandoffIfNeeded(db,{inbound:ai,env})).created===false&&(await handoffs.createSalesAutomationFallbackHandoff(db,{inbound:ai,env})).created===false&&state.mocks.length===old);
  });
  await group('Legal_server_operations',async()=>{
   const c=contact('legal-processor'),r=await capture('Qué incluye la póliza jurídica',c);
   const legal=await importWithStubs(new URL('../lib/agentsV2/processLegalInbound.js',import.meta.url),{
    './openaiLegalAgent':{createLegalSession:async()=>({id:tag+'-legal-session'}),getLegalSession:async id=>({id,status:'idle'}),fulfillLegal:forbidden,legalOutput:async()=> 'La consulta general de póliza puede ser revisada por Jurídico.'},
    '../ejecutivo/respondSync':{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:m=>m.at},'../shadow/coordinator':{sanitizeShadowText},'./legalHandoff':{createAndDispatchLegalHandoff},'./agentUsage':usage,
   });
   check('legal_processor_sent_synthetic',(await legal.processLegalInboundById(db,r.inboundId,{env})).status==='sent');
   check('legal_duplicate_no_second_run',(await legal.processLegalInboundById(db,r.inboundId,{env})).status==='not_claimed');
   check('legal_outbound_insert_readback',(await readContact('legal_agent_v1_auto_outbound',c)).length===1);
   const lc=contact('legal-handoff'),lr=await capture('Qué incluye Blindaje Legal',lc),inbound=await row(tables.LEGAL,lr.inboundId),start=state.mocks.length;
   const handoff=await createAndDispatchLegalHandoff(db,{inbound,env});
   check('legal_handoff_S_I_U',handoff.assignmentTriggered===true&&(await row('legal_agent_v1_handoffs',handoff.handoffId)).ack_sent_at);
   check('legal_retry_one_workflow_one_ACK',(await createAndDispatchLegalHandoff(db,{inbound,env})).created===false&&state.mocks.slice(start).filter(x=>x.kind==='workflow').length===1&&state.mocks.slice(start).filter(x=>x.kind==='message').length===1);
  });
  await group('legacy_OFF_and_Administration',async()=>{
   const c=contact('legacy'),e=await makeEvent(c,'498219');
   check('flag_OFF_no_new_route',(await captureSocialRoute(db,{message:{text:'Busco casa'}},e,{env})).handled===false);
   const body={event_type:e.eventType,event_id:e.eventId,contact:{id:c},message:{id:e.messageId,text:'Busco casa',channelId:'498219',timestamp:day2}};
   check('legacy_WhatsApp_capture_unchanged',(await captureRespondSalesV2InboundIsolated(db,body)).status==='captured');
   check('legacy_WhatsApp_duplicate',(await captureRespondSalesV2InboundIsolated(db,body)).status==='duplicate');
   check('legacy_no_social_marker',(await readContact(tables.SALES,c))[0].social_route_id===null);
   for(const [name,fn,text] of [['Owner',captureRespondOwnerInboundIsolated,'Soy propietaria, quiero vender mi casa'],['Legal',captureRespondLegalInboundIsolated,'Qué incluye la póliza jurídica']]){
    const lc=contact('legacy-'+name),le=await makeEvent(lc,'498219'),b={event_type:le.eventType,event_id:le.eventId,contact:{id:lc},message:{id:le.messageId,text,channelId:'498219',timestamp:day2}};
    check('legacy_'+name+'_capture',(await fn(db,b)).status==='captured');
   }
   const ae={...e,channelId:'544519'};
   check('Administration_not_social',(await captureSocialRoute(db,{message:{text:'Mantenimiento'}},ae,{env:enabled})).handled===false);
   const config=resolveRespondChannelRouterConfig({routerEnabled:'true',adminChannelId:'544519',commercialChannelIds:JSON.stringify(['497382','497385','498219','515318']),adminWorkflowUrl:'https://hooks.respond.io/synthetic-social-dev-admin',commercialWorkflowUrl:'https://hooks.respond.io/synthetic-social-dev-commercial',commercialCutoverEnabled:'true'});
   check('legacy_Administration_routing_intact',decideRespondMessageRoute(ae,config).decision==='admin_human');
   check('commercial_cutover_no_Ivonne',decideRespondMessageRoute(e,config).decision==='commercial_sales_v2');
  });
 }finally{
  await save();
  const allowedWrites=new Set(['gv_respond_webhook_events','profiles','clientes','propiedades','gv_respond_contact_snapshots','gv_opportunities','respond_appointment_sync',...Object.values(tables),'owner_agent_v1_runs','owner_agent_v1_auto_outbound','sales_agent_v2_shadow_runs','sales_agent_v2_handoffs','legal_agent_v1_runs','legal_agent_v1_auto_outbound','legal_agent_v1_handoffs','capture_social_route_v1','commit_social_appointment_v1','reserve_social_effect_v1','finish_social_effect_v1']);
  check('no_identity_or_unexpected_app_mutations',ops.filter(x=>x.operation!=='select').every(x=>allowedWrites.has(x.table)));
  check('runtime_flag_still_OFF',process.env.SOCIAL_ROUTING_V1_ENABLED!=='true');
  check('no_unexpected_network',state.blocked()===0);
  const report={project:state.project,tag,reports,pass:reports.filter(x=>x.result==='PASS').length,fail:reports.filter(x=>x.result==='FAIL').length,processFlag:process.env.SOCIAL_ROUTING_V1_ENABLED||'unset_default_OFF',positiveRoutingOption:'test-local only',realRespondCalls:0,realModelCalls:0,mockedExternalEffects:state.mocks.length-externalBefore,operationCounts:Object.fromEntries([...new Set(ops.map(x=>x.table))].map(t=>[t,Object.fromEntries([...new Set(ops.filter(x=>x.table===t).map(x=>x.operation))].map(o=>[o,ops.filter(x=>x.table===t&&x.operation===o).length]))])),cleanup:'pending_scoped_owner_cleanup'};
  await writeFile(state.dir+'/'+tag+'-result.json',JSON.stringify(report,null,2),{mode:0o600});
  emit({stage:'DEV_certification_finished',pass:report.pass,fail:report.fail,report:state.dir+'/'+tag+'-result.json',inventory:state.dir+'/inventory.json'});
 }
}

export async function cleanupActors(admin,state,emit){
 for(const inventory of state.inventories||[])for(const id of inventory.actors){
  await need(admin.auth.admin.deleteUser(id));
  assert.equal((await need(admin.from('profiles').select('id').eq('id',id))).length,0);
 }
 emit({stage:'synthetic_Auth_actors_removed',count:(state.inventories||[]).reduce((n,i)=>n+i.actors.length,0)});
}
