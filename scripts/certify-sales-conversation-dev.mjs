// Explicit DEV-only integration. Real PostgREST, processor, tools, sender and
// review projection; only provider/Respond transport and the review Auth boundary
// are synthetic. No hosted variables, migrations, real messages or model calls.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { captureSocialRoute } from '../lib/social/routing.js';
import { processSocialRouteImmediate } from '../lib/social/immediate.js';
import { sanitizeShadowText } from '../lib/shadow/coordinator.js';
import * as agent from '../lib/agentsV2/openaiSalesAgent.js';
import * as usage from '../lib/agentsV2/agentUsage.js';
import * as handoffs from '../lib/agentsV2/salesHandoff.js';
import * as sender from '../lib/agentsV2/salesAutoOutbound.js';
import { LINK_ALTERNATIVE } from '../lib/agentsV2/salesConversation.js';
import { SOCIAL_CTA_CLARIFICATION } from '../lib/social/commercialIntent.js';
import { importWithStubs } from '../tests/helpers/socialFixtures.mjs';

const PROJECT='hjfwjnejbcpmknvfpdcq', URL=`https://${PROJECT}.supabase.co`;
const need=async q=>{const r=await q;if(r.error)throw Object.assign(Error('dev_database_operation_failed'),{code:r.error.code});return r.data;};
const stamp=()=>new Date().toISOString();

export async function certifySalesConversationDev(db,dir){
  assert.equal(db.supabaseUrl.replace(/\/$/,''),URL);
  const tag='sales-recovery-dev-'+randomBytes(5).toString('hex');
  const inventory={project:PROJECT,tag,contacts:[],events:[],properties:[]};
  const checks=[],sessions=[],deliveries=[],toolResults=[];
  const originalFetch=globalThis.fetch;
  let plan=null,seq=0,activeCase='preflight',unexpectedNetwork=0;
  const env={SOCIAL_ROUTING_V1_ENABLED:'true',SALES_AGENT_V2_ENABLED:'true',SALES_AGENT_V2_PRODUCTION_SHADOW_ENABLED:'true',SALES_AGENT_V2_AUTO_OUTBOUND_ENABLED:'true',SALES_AGENT_V2_AUTO_SHADOW_ENABLED:'true',VERCEL_ENV:'production',SUPABASE_ENVIRONMENT:'production',RESPOND_IO_TOKEN:'synthetic-only',OPENAI_API_KEY:'synthetic-only',OPENAI_SALES_AGENT_MODEL:'synthetic-no-provider',SALES_AGENT_V2_RECOVERY_ENABLED:'false',SALES_AGENT_V2_HANDOFF_SLA_ENABLED:'false'};
  const save=()=>writeFile(join(dir,'inventory.json'),JSON.stringify(inventory,null,2),{mode:0o600});
  const check=(name,ok)=>{assert.ok(ok,name);checks.push({case:activeCase,name,result:'PASS'});};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const rows=(table,c,select='*')=>need(db.from(table).select(select).eq('respond_contact_id',c));
  const row=(table,id)=>need(db.from(table).select('*').eq('id',id).single());
  const contact=async(name,assigned=false)=>{
    const c=tag+'-'+name;inventory.contacts.push(c);await save();
    await need(db.from('gv_respond_contact_snapshots').insert({respond_contact_id:c,respond_channel_id:'497382',respond_record_active:true,metadata:{mapping_method:'current_assignee_unassigned'},...(assigned?{respond_assignee_id:'synthetic-existing-advisor'}:{})}));
    return c;
  };
  const capture=async(c,text,at=stamp())=>{
    const event={eventType:'message.received',eventId:tag+'-e'+(++seq),messageId:tag+'-m'+seq,respondContactId:c,channelId:'497382',eventOccurredAt:at};
    inventory.events.push(event.eventId);await save();
    await need(db.from('gv_respond_webhook_events').insert({event_id:event.eventId,event_type:event.eventType,respond_contact_id:c,message_id:event.messageId,event_occurred_at:at,status:'processed',processed_at:stamp(),payload_meta:{synthetic_certification:true}}));
    const route=await captureSocialRoute(db,{message:{text}},event,{env});
    check('exclusive_sales_route',route.destination==='SALES'&&Boolean(route.inboundId));
    return route;
  };
  globalThis.fetch=async(input,options={})=>{
    const u=new globalThis.URL(String(input)),method=options.method||'GET';
    if(u.origin==='https://api.openai.com'){
      if(u.pathname==='/v1/agents/sessions'&&method==='POST'){
        assert.ok(plan,'synthetic_plan_required');
        const session={id:tag+'-s'+sessions.length,input:JSON.parse(options.body).input,plan:structuredClone(plan),fulfilled:false};sessions.push(session);return json({id:session.id});
      }
      const match=u.pathname.match(/^\/v1\/agents\/sessions\/([^/]+)(?:\/(items|events|turns))?$/),session=sessions.find(s=>s.id===match?.[1]);
      assert.ok(session,'only_allowlisted_synthetic_session');
      if(match[2]==='events'&&method==='POST'){
        const events=JSON.parse(options.body).events;assert.ok(events.every(e=>e.success===true),'real_tool_execution_success');
        toolResults.push(...events.map(e=>JSON.parse(e.output)));session.fulfilled=true;return json({ok:true});
      }
      if(match[2]==='items')return json({data:[{role:'assistant',content:[{text:session.plan.output}]}]});
      if(match[2]==='turns')return json({data:[{usage:{input_tokens:10,output_tokens:10,total_tokens:20}}]});
      return json({id:session.id,status:session.plan.tools?.length&&!session.fulfilled?'requires_action':'idle',required_actions:(session.plan.tools||[]).map((t,i)=>({type:'function_call',name:t.name,arguments:t.args||{},turn_id:'synthetic-turn',call_id:'synthetic-call-'+i}))});
    }
    if(u.origin==='https://api.respond.io'&&method==='POST'&&u.pathname.endsWith('/message')){
      const c=decodeURIComponent(u.pathname.slice('/v2/contact/id:'.length,-'/message'.length));
      assert.ok(inventory.contacts.includes(c),'synthetic_contact_only');
      const body=JSON.parse(options.body);assert.equal(body.channelId,497382);
      const receipt=tag+'-receipt-'+deliveries.length;deliveries.push({contact:c,text:body.message.text,receipt});return json({messageId:receipt});
    }
    unexpectedNetwork++;throw Error('unexpected_network_denied');
  };
  const runner=await importWithStubs(new globalThis.URL('../lib/agentsV2/runSalesShadowMessage.js',import.meta.url),{
    './openaiSalesAgent':agent,'../shadow/coordinator':{sanitizeShadowText},
    '../ejecutivo/respondSync':{readRespondMessages:async()=>({messages:[]}),respondMessageTimestamp:m=>m.at},
  });
  const processor=await importWithStubs(new globalThis.URL('../lib/agentsV2/processSalesInbound.js',import.meta.url),{
    './runSalesShadowMessage':runner,'./salesHandoff':handoffs,'./salesAutoOutbound':sender,'./agentUsage':usage,'./openaiSalesAgent':agent,
  });
  const run=async(route,output,tools=[])=>{plan={output,tools};return processor.processSalesInboundById(db,route.inboundId,{env});};
  const step=async(c,text,output,tools=[])=>{const route=await capture(c,text);return {route,result:await run(route,output,tools)};};
  const sent=r=>check('allowed_response_reaches_intercepted_sender',r.result.outbound?.status==='sent');
  const review=async(c,reason)=>{
    const r=await rows('sales_agent_v2_handoffs',c);check('one_visible_review',r.length===1&&r[0].assignment_error_code===reason);
    check('no_assignment_or_ACK',r[0].assignment_requested_at===null&&r[0].ack_sent_at===null&&r[0].reassignment_count===0);
  };
  let failure=null;
  try{
    await save();
    activeCase='fixture_preflight';
    check('public_listing_fixture_no_collision',(await need(db.from('propiedades').select('id').eq('public_id','EMP-MUN7BHJX'))).length===0);
    const property=randomUUID();inventory.properties.push(property);await save();
    await need(db.from('propiedades').insert({id:property,public_id:'EMP-MUN7BHJX',titulo:'Casa en Venta en Chapulco, Puebla | 3 Recámaras y Vista a la Laguna',status:'published',operacion:'sale',tipo:'Casa',precio:1800000,moneda:'MXN',recamaras:3,colonia:'Chapulco',ciudad:'Puebla',direccion:'Ubicación sintética DEV'}));

    activeCase='rental_context_then_human';
    const mar=await contact('rental',true);
    sent(await step(mar,'Busco departamento amueblado con estacionamiento','¿Buscas renta o compra?'));
    sent(await step(mar,'Renta','¿Qué zona prefieres para el departamento en renta?'));
    check('requested_rental_answer_not_CTA',sessions.at(-1).input.includes('estacionamiento')&&sessions.at(-1).input.includes('Renta'));
    sent(await step(mar,'https://social.example.invalid/synthetic-one',SOCIAL_CTA_CLARIFICATION));
    sent(await step(mar,'Este','¿Cuál es tu presupuesto para el departamento?'));
    sent(await step(mar,'Torre Edificio Sintético','¿Qué presupuesto tienes para la renta en ese edificio?'));
    check('building_and_rental_context_preserved',sessions.at(-1).input.includes('Torre Edificio Sintético')&&sessions.at(-1).input.includes('Renta'));
    const modelCount=sessions.length,human=await step(mar,'Quiero hablar con una persona','must-not-be-used');
    check('human_request_no_model',sessions.length===modelCount&&human.result.handoff.created);
    await review(mar,'existing_responsible_preserved');
    await step(mar,'¿Eres una IA? Quiero hablar con una persona','must-not-be-used');
    await review(mar,'existing_responsible_preserved');
    check('existing_advisor_unchanged',(await rows('gv_respond_contact_snapshots',mar))[0].respond_assignee_id==='synthetic-existing-advisor');

    activeCase='rental_location_repeated_links';
    const nai=await contact('location');
    sent(await step(nai,'Busco departamentos en renta','¿En qué ciudad buscas el departamento?'));
    sent(await step(nai,'En Puebla','¿Qué presupuesto tienes para la renta en Puebla?'));
    sent(await step(nai,'https://social.example.invalid/synthetic-two','¿Tienes el enlace de la propiedad?'));
    await step(nai,'Alguna de estas https://social.example.invalid/synthetic-three','Compárteme el enlace.');
    await review(nai,'unresolved_reference_requires_review');
    check('alternative_once_only',deliveries.filter(x=>x.contact===nai&&x.text===LINK_ALTERNATIVE).length===1);
    check('no_repeated_fixed_CTA',!deliveries.some(x=>x.contact===nai&&x.text===SOCIAL_CTA_CLARIFICATION));

    activeCase='visit_plus_Plis';
    const visit=await contact('visit'),now=Date.now();
    const first=await capture(visit,'Me gustaría visitar la casa en Momoxpan',new Date(now-2000).toISOString());
    const last=await capture(visit,'Plis',new Date(now-214).toISOString());
    const absorbed=await processSocialRouteImmediate(db,first,{SALES:()=>assert.fail('older_fragment_must_not_run')},{env,sleep:async()=>{}});
    check('older_fragment_absorbed',absorbed.status==='absorbed_by_newer_message');
    const visitResult=await run(last,'Podemos solicitar una visita; requiere confirmación del asesor.');
    check('visit_intent_survives',visitResult.handoff?.reason==='appointment_intent'&&sessions.at(-1).input.includes('Me gustaría visitar'));
    await review(visit,'workflow_not_configured');
    check('no_fragment_send',!deliveries.some(x=>x.contact===visit));

    activeCase='public_reference_then_short_followup';
    const ref=await contact('reference');
    const linked=await step(ref,'Información de https://www.emporioinmobiliario.com.mx/propiedades/EMP-MUN7BHJX?tracking=discard','La publicación EMP-MUN7BHJX indica $1,800,000 MXN.',[{name:'search_sales_inventory',args:{zone:'otra zona'}}]);sent(linked);
    const stored=await row('social_message_routes',linked.route.routeId);
    check('public_reference_resolved_before_sanitization',stored.source_property_id===property&&stored.sanitized_text.includes('[URL]')&&!JSON.stringify(stored).includes('tracking'));
    check('actual_inventory_tool_uses_origin',toolResults.at(-1).sourceConfirmed===true&&toolResults.at(-1).listings[0].publicId==='EMP-MUN7BHJX');
    sent(await step(ref,'Este','Te confirmo la información publicada.',[{name:'search_sales_inventory',args:{}}]));

    activeCase='Chapulco';
    const chap=await contact('chapulco');
    sent(await step(chap,'Hola me puedes dar información de una casa atrás de la laguna de Chapulco','La publicación EMP-MUN7BHJX indica $1,800,000 MXN.',[{name:'search_sales_inventory',args:{zone:'atrás de la laguna de Chapulco'}}]));
    check('real_inventory_matches_Chapulco',toolResults.at(-1).listings.some(x=>x.publicId==='EMP-MUN7BHJX'&&x.price===1800000));
    sent(await step(chap,'Buen día, disponible para visita la casa de 3 recámaras en Chapulco?','Podemos solicitar una visita con un asesor.',[{name:'search_sales_inventory',args:{zone:'Chapulco'}}]));
    check('coordination_not_false_booking',!(await rows('sales_agent_v2_handoffs',chap)).length);

    activeCase='rental_requirements';
    const req=await contact('requirements');
    sent(await step(req,'Busco departamento en renta','¿Qué zona prefieres?'));
    const requirements=await step(req,'Qué documentos necesito para rentar?','Los requisitos generales incluyen INE vigente y comprobantes de ingresos de los últimos 3 meses. No implica aprobación del caso.',[{name:'get_rental_requirements',args:{topic:'documents'}}]);sent(requirements);
    check('requirements_decision_retained',requirements.result.outbound.caseKind==='rental_requirements');
    check('original_constraint_compatible',(await rows('sales_agent_v2_auto_outbound',req)).every(x=>x.case_kind!=='rental_requirements'));
    check('grounded_requirement_tool_persisted',(await need(db.from('sales_agent_v2_shadow_runs').select('called_tools').eq('inbound_message_id',requirements.route.inboundId)))[0].called_tools.includes('get_rental_requirements'));

    activeCase='unsafe_output_and_duplicate';
    const unsafe=await contact('unsafe'),u=await step(unsafe,'Información de la casa','Firma el contrato.');
    check('unsafe_blocked_with_reason',u.result.outbound.status==='blocked'&&(await rows('sales_agent_v2_auto_outbound',unsafe))[0].error_code==='risky_topic');
    await review(unsafe,'sender_requires_review');
    const duplicate=await contact('duplicate'),route=await capture(duplicate,'Información de la casa');plan={output:'Te confirmo cuál es.',tools:[]};
    const concurrent=await Promise.all([processor.processSalesInboundById(db,route.inboundId,{env}),processor.processSalesInboundById(db,route.inboundId,{env})]);
    check('one_concurrent_processor',concurrent.filter(x=>x.status==='not_claimed').length===1);
    check('one_concurrent_send',deliveries.filter(x=>x.contact===duplicate).length===1);
    check('retry_does_not_send',(await processor.processSalesInboundById(db,route.inboundId,{env})).status==='not_claimed');

    activeCase='actionable_review_projection';
    const operator=(await need(db.from('profiles').select('id').eq('active',true).in('role_id',['admin','gerente_ventas']).limit(1)))[0];
    check('existing_DEV_operator',Boolean(operator));
    const handler=(await importWithStubs(new globalThis.URL('../pages/api/operaciones/sales-v2-shadow-view.js',import.meta.url),{
      '@supabase/supabase-js':{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:operator.id}}})},from:db.from.bind(db)})},
      '../../../lib/ejecutivo/workCenter':{getAdminSupabase:()=>db,respondInboxLink:c=>inventory.contacts.includes(c)?'https://app.respond.io/synthetic-dev-only':null},
    })).default;
    const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'GET',headers:{authorization:'Bearer synthetic-auth-boundary'},query:{}},res);
    check('actual_review_query_and_projection',res.code===200&&res.body.ok);
    for(const c of [mar,nai,visit,unsafe]){
      const r=res.body.reviews.find(x=>x.respond_contact_id===c);check('review_has_operational_owner_and_link',Boolean(r?.operationalOwner&&r?.inboxUrl&&r?.assignment_error_code));
    }
    check('no_unexpected_network',unexpectedNetwork===0);
    check('one_sent_journal_per_transport_receipt',(await need(db.from('sales_agent_v2_auto_outbound').select('id,provider_message_id').in('respond_contact_id',inventory.contacts).eq('status','sent'))).length===deliveries.length);
    const handoffIds=(await need(db.from('sales_agent_v2_handoffs').select('id').in('respond_contact_id',inventory.contacts))).map(x=>x.id);
    check('no_assignment_effects',(await need(db.from('social_handoff_effects').select('id').in('handoff_id',handoffIds))).length===0);
  }catch(error){
    failure={case:activeCase,code:/^[A-Za-z0-9_]+$/.test(error.code||'')?error.code:null,reason:error.name==='AssertionError'?String(error.message).split('\n')[0]:'dev_harness_or_database_failure'};
  }finally{
    globalThis.fetch=originalFetch;
    const report={status:failure?'FAIL':'DEV_FUNCTIONAL_PASS_CLEANUP_PENDING',project:PROJECT,tag,checks,failure,interceptedMessages:deliveries.length,syntheticModelSessions:sessions.length,unexpectedNetwork,realRespondCalls:0,realModelCalls:0,hostedFlagChanges:0,reviewAuth:'synthetic Auth boundary; real DEV profile and all review queries',cleanup:'pending_exact_fixture_inventory_via_privileged_connector'};
    await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify({status:report.status,checks:checks.length,failure,dir}));
  }
  return !failure;
}

// Hidden input is supplied by the local .command launcher through stdin only.
if(process.argv.includes('--credential-stdin')){
  const nativeFetch=globalThis.fetch,parts=[];for await(const part of process.stdin)parts.push(part);
  let credential=Buffer.concat(parts).toString('utf8').trim();parts.forEach(p=>p.fill(0));
  if(!/^(sb_secret_|eyJ)/.test(credential))throw Error('DEV_credential_format_required');
  const db=createClient(URL,credential,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,options)=>{
    const target=new globalThis.URL(typeof input==='string'?input:input.url);
    if(target.origin!==URL||!target.pathname.startsWith('/rest/v1/'))throw Error('non_DEV_database_request_denied');
    return nativeFetch(input,options);
  }}});credential='';
  const dir=await mkdtemp(join(tmpdir(),'sales-recovery-dev-'));
  try{
    const ok=await certifySalesConversationDev(db,dir);if(!ok)process.exitCode=1;
  }catch{
    console.error(JSON.stringify({status:'DEV_HARNESS_BOOTSTRAP_FAILURE',dir}));process.exitCode=1;
  }
}
