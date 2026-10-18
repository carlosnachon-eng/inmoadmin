import {businessConfig,isRef} from './config.js';
import {persistBusinessReceipt} from './observer.js';
import {createBusinessStore} from './store.js';
import {runBusinessReply,runBusinessMediaReply} from './manual.js';
import {projectBusinessHistory,loadBusinessMedia} from './inbox.js';
import {beginBusinessOAuth,completeBusinessOAuth,businessOAuthDiagnostic,health,maintainBusinessToken} from './tokenLifecycle.js';
import {sameOriginAdminRequest} from '../../../shadow/identityBootstrap.js';
import {resolveBusinessProfile} from './profile.js';
import {importRecentBusinessHistory} from './historyImport.js';
import {createHash,timingSafeEqual} from 'node:crypto';

const normalizePhone=value=>{const d=String(value||'').replace(/\D/g,'');return d.length>10?d.slice(-10):d;};
const mxDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const plusOneMx=fecha=>{
 const d=new Date(fecha+'T12:00:00-06:00');d.setDate(d.getDate()+1);
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
};
async function threadAppointments(db,connection,thread){
 const {data:link,error:le}=await db.schema('instagram_business_private').from('thread_clients')
  .select('client_id').eq('connection_id',connection).eq('thread_ref',thread).maybeSingle();
 if(le||!link?.client_id)return [];
 const {data,error}=await db.from('citas')
  .select('id,fecha_hora,estado,notas,created_at,propiedad_id,asesor_id,propiedades:propiedad_id(titulo,public_id),profiles:asesor_id(full_name,email)')
  .eq('cliente_id',link.client_id).order('created_at',{ascending:true}).limit(20);
 if(error)return [];
 return (data||[]).map(x=>({id:x.id,fecha_hora:x.fecha_hora,estado:x.estado,notas:x.notas||null,created_at:x.created_at,
  property_title:x.propiedades?.titulo||null,property_public_id:x.propiedades?.public_id||null,
  advisor_name:x.profiles?.full_name||x.profiles?.email||null}));
}
async function syncAppointmentKpis(db,advisorId,fechaHora){
 const fecha=mxDate(fechaHora),next=plusOneMx(fecha);
 const [{data:profile,error:pe},{data:appointments,error:ae}]=await Promise.all([
  db.from('profiles').select('email,full_name').eq('id',advisorId).maybeSingle(),
  db.from('citas').select('estado,fecha_hora').eq('asesor_id',advisorId).gte('fecha_hora',fecha+'T00:00:00-06:00').lt('fecha_hora',next+'T00:00:00-06:00')
 ]);
 if(pe||ae||!profile?.email)return false;
 const rows=(appointments||[]).filter(x=>mxDate(x.fecha_hora)===fecha);
 const values={citas_agendadas:rows.length,citas_efectivas:rows.filter(x=>['efectiva','calificada'].includes(x.estado)).length,citas_calificadas:rows.filter(x=>x.estado==='calificada').length};
 const {data:existing,error:ee}=await db.from('kpis_diarios').select('id').eq('email',profile.email).eq('fecha',fecha).maybeSingle();
 if(ee)return false;
 if(existing){const {error}=await db.from('kpis_diarios').update(values).eq('id',existing.id);return !error;}
 const {error}=await db.from('kpis_diarios').insert({...values,fecha,asesor:profile.full_name||profile.email,email:profile.email});return !error;
}

const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
export function createBusinessWebhook({getDb,env=()=>process.env,diagnostic=record=>console.info('instagram_business_webhook_diagnostic',record)}){
 return async(req,res)=>{
  // Request-local fixed labels only. Never log exception text, headers or event data.
  let stage='configuration',hmac=null;
  const stages=new Set(['configuration','content_type','raw_body','body_size','database_client','signature','json','envelope','account','account_allowlist','messaging_structure','event_shape','event_binding','attachments','content_encryption','recipient_encryption','persistence','durable_ack']);
  const mark=s=>{stage=stages.has(s)?s:'unknown';if(s==='signature')hmac=false;if(s==='json')hmac=true;};
  const report=(status,rejected)=>{if(req.method==='POST')try{diagnostic({hmac_valid:hmac,rejection_stage:rejected?stage:null,http_status:status});}catch{/* Observability must not change acknowledgement. */}};
  res.setHeader('Cache-Control','no-store');let c;try{c=businessConfig(env());}catch{report(503,true);return res.status(503).json({status:'unavailable'});}
  if(!c)return res.status(404).end();
  if(req.method==='GET'){
   if(req.query?.['hub.mode']!=='subscribe'||!equal(req.query?.['hub.verify_token'],c.verify)||!/^\d{1,64}$/.test(req.query?.['hub.challenge']||''))return res.status(403).end();
   return res.status(200).send(req.query['hub.challenge']);
  }
  if(req.method!=='POST')return res.status(405).end();
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){mark('content_type');report(415,true);return res.status(415).end();}
  let raw;try{mark('raw_body');let n=0;const chunks=[];for await(const v of req){const b=Buffer.from(v);n+=b.length;if(n>262144){mark('body_size');report(413,true);return res.status(413).end();}chunks.push(b);}raw=Buffer.concat(chunks);
   mark('database_client');const store=createBusinessStore(await getDb(),c.connection);
   const result=await persistBusinessReceipt({raw,signature:req.headers['x-hub-signature-256'],config:c,store,mark});
   report(200,false);
   return res.status(200).json(result);
  }catch(e){const status=e.message==='signature_denied'?401:503;report(status,true);return res.status(status).json({status:'not_acknowledged'});}
 };
}
export function createBusinessInboxApi({authorize,getDb,env=()=>process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const c=businessConfig(env());if(!c)return res.status(404).end();
   const actor=await authorize(req);if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))return res.status(403).json({status:'forbidden'});
   const db=await getDb(),store=createBusinessStore(db,c.connection),op=req.query?.op||'threads';
   if(c.production&&!await store.authorizedOperator(actor.id))return res.status(403).json({status:'forbidden'});
   if(req.method==='POST'){
    if(!sameOriginAdminRequest(req)){
     if(op==='reply')console.info('instagram_business_reply_diagnostic',{stage:'origin',status:'blocked'});
     return res.status(403).json({status:'origin_denied'});
    }
    if(op==='reply'){
     const result=await runBusinessReply({config:c,actor,body:req.body,store,diagnostics:true});
     console.info('instagram_business_reply_diagnostic',{stage:result?.diagnostic?.validation||'dispatch',status:result?.status||'unknown'});
     return res.status(200).json(result);
    }
    if(op==='media-reply'){
     const result=await runBusinessMediaReply({config:c,actor,body:req.body,store,diagnostics:true});
     return res.status(200).json(result);
    }
    if(op==='history-sync')return res.status(200).json(await importRecentBusinessHistory({config:c,actor,store}));
    if(op==='client-match'){
     const body=req.body||{};
     if(Object.keys(body).sort().join(',')!=='email,phone')return res.status(400).end();
     const phone=normalizePhone(body.phone),email=String(body.email||'').trim().toLowerCase();
     if(!phone&&!email)return res.status(200).json({rows:[]});
     const filters=[];if(phone)filters.push('telefono.ilike.%'+phone);if(email)filters.push('correo.eq.'+email);
     const {data,error}=await db.from('clientes')
      .select('id,nombre,telefono,correo,asesor_id,created_at,profiles:asesor_id(full_name,email)')
      .or(filters.join(',')).limit(10);
     if(error)throw Error('client_match_unavailable');
     return res.status(200).json({rows:(data||[]).map(c=>({
      id:c.id,nombre:c.nombre,telefono:c.telefono||null,correo:c.correo||null,asesor_id:c.asesor_id||null,
      asesor_nombre:c.profiles?.full_name||c.profiles?.email||null
     }))});
    }
    if(op==='appointment-create'){
     const body=req.body||{};
     const keys=Object.keys(body).sort().join(',');
     if(keys!=='advisor_id,client_id,email,fecha_hora,name,notas,phone,property_id,thread')return res.status(400).end();
     if(!isRef(body.thread)||typeof body.name!=='string'||body.name.trim().length<1||body.name.trim().length>120)return res.status(400).end();
     if(typeof body.phone!=='string'||body.phone.length>32||typeof body.email!=='string'||body.email.length>254||typeof body.notas!=='string'||body.notas.length>500)return res.status(400).end();
     if(typeof body.fecha_hora!=='string'||!Number.isFinite(Date.parse(body.fecha_hora)))return res.status(400).end();
     const history=await store.history(body.thread,actor.id);if(!history)return res.status(403).end();

     const {data:advisor,error:advisorError}=await db.from('profiles').select('id,active,role_id').eq('id',body.advisor_id).maybeSingle();
     if(advisorError||!advisor?.active||!['asesor','gerente_ventas','admin'].includes(advisor.role_id))return res.status(400).json({status:'advisor_invalid'});

     let property=null;
     if(body.property_id){
      const {data,error}=await db.from('propiedades').select('id,titulo,public_id,status').eq('id',body.property_id).maybeSingle();
      if(error||!data||data.status!=='published')return res.status(400).json({status:'property_invalid'});
      property=data;
     }

     const {data:link,error:linkError}=await db.schema('instagram_business_private').from('thread_clients')
      .select('client_id').eq('connection_id',c.connection).eq('thread_ref',body.thread).maybeSingle();
     if(linkError)throw linkError;
     let clientId=body.client_id||link?.client_id||null;
     if(clientId){
      const {data:existing,error}=await db.from('clientes').select('id,asesor_id').eq('id',clientId).maybeSingle();
      if(error||!existing)return res.status(400).json({status:'client_invalid'});
      clientId=existing.id;
     }else{
      const {data:client,error}=await db.from('clientes').insert({
       nombre:body.name.trim(),telefono:normalizePhone(body.phone)||null,correo:body.email.trim().toLowerCase()||null,asesor_id:body.advisor_id
      }).select('id').single();
      if(error)throw error;clientId=client.id;
     }
     const {error:mapError}=await db.schema('instagram_business_private').from('thread_clients').upsert({
      connection_id:c.connection,thread_ref:body.thread,client_id:clientId,linked_by:actor.id,linked_at:new Date().toISOString()
     },{onConflict:'connection_id,thread_ref'});
     if(mapError)throw mapError;

     const {data:appointment,error:appointmentError}=await db.from('citas').insert({
      cliente_id:clientId,propiedad_id:property?.id||null,asesor_id:body.advisor_id,fecha_hora:body.fecha_hora,estado:'agendada',notas:body.notas.trim()||null
     }).select('id,asesor_id,fecha_hora,estado').single();
     if(appointmentError)throw appointmentError;
     const kpi_synced=await syncAppointmentKpis(db,appointment.asesor_id,appointment.fecha_hora);
     return res.status(200).json({status:'created',appointment_id:appointment.id,kpi_synced,property_title:property?.titulo||null,property_public_id:property?.public_id||null});
    }
    if(op==='alias-set'){
     if(!isRef(req.body?.thread)||typeof req.body?.alias!=='string'||Object.keys(req.body).sort().join(',')!=='alias,thread')return res.status(400).end();
     return res.status(200).json(await store.alias(req.body.thread,actor.id,'set',req.body.alias));
    }
    if(op==='contact-set'){
     if(!isRef(req.body?.thread)||typeof req.body?.phone!=='string'||typeof req.body?.email!=='string'
       ||Object.keys(req.body).sort().join(',')!=='email,phone,thread')return res.status(400).end();
     return res.status(200).json(await store.contact(req.body.thread,actor.id,'set',req.body.phone,req.body.email));
    }
    // Explicit operator maintenance; no sending and no browser token response.
    if(op==='maintain')return res.status(200).json(await maintainBusinessToken({config:c,store}));
    if(op==='oauth-start')return res.status(200).json({url:await beginBusinessOAuth({config:c,actor:actor.id,sessionBinding:req.headers.authorization,store})});
    if(op==='oauth-complete'){
     if(Object.keys(req.body||{}).sort().join(',')!=='code,state')return res.status(400).end();
     return res.status(200).json(await completeBusinessOAuth({config:c,actor:actor.id,sessionBinding:req.headers.authorization,store,...req.body}));
    }
    return res.status(400).end();
   }
   if(req.method!=='GET')return res.status(405).end();
   if(op==='health')return res.status(200).json(health(await store.loadCredential()));
   if(op==='appointment-options'){
    const {data,error}=await db.from('profiles').select('id,full_name,email,role_id,participa_kpis').eq('active',true).in('role_id',['asesor','gerente_ventas','admin']).order('full_name',{ascending:true});
    if(error)throw Error('appointment_options_unavailable');
    return res.status(200).json({advisors:(data||[]).map(x=>({id:x.id,name:x.full_name||x.email,role_id:x.role_id,participa_kpis:x.participa_kpis!==false}))});
   }
   if(op==='properties'){
    const {data,error}=await db.from('propiedades')
     .select('id,public_id,titulo,operacion,precio,moneda,tipo,colonia,ciudad,status,fotos')
     .eq('status','published')
     .not('public_id','is',null)
     .order('updated_at',{ascending:false})
     .limit(150);
    if(error)throw Error('properties_unavailable');
    const rows=(data||[]).map(p=>({
     id:p.id,public_id:p.public_id,titulo:p.titulo||'Propiedad',
     operacion:p.operacion,precio:p.precio,moneda:p.moneda||'MXN',tipo:p.tipo||null,
     colonia:p.colonia||null,ciudad:p.ciudad||null,
     foto:Array.isArray(p.fotos)&&p.fotos.length?(p.fotos[0]?.url||p.fotos[0]||null):null
    }));
    return res.status(200).json({rows});
   }
   if(op==='threads')return res.status(200).json({rows:await store.threads(actor.id),sender_enabled:c.senderEnabled});
   if(op==='alias-get'){
    if(!isRef(req.query.thread))return res.status(400).end();
    return res.status(200).json(await store.alias(req.query.thread,actor.id,'get'));
   }
   if(op==='contact-get'){
    if(!isRef(req.query.thread))return res.status(400).end();
    return res.status(200).json(await store.contact(req.query.thread,actor.id,'get'));
   }
   if(!isRef(req.query.thread))return res.status(400).end();
   const h=await store.history(req.query.thread,actor.id);if(!h)return res.status(403).end();
   if(op==='history')return res.status(200).json({rows:projectBusinessHistory({config:c,...h}),sender_enabled:c.senderEnabled,profile:await resolveBusinessProfile({config:c,history:h,store}),appointments:await threadAppointments(db,c.connection,req.query.thread)});
   if(op==='media'){
    const row=h.rows.find(e=>e.event_ref===req.query.input);if(!row||h.tombstones.has(row.message_ref))return res.status(404).end();
    const authorized=async e=>{const fresh=await store.history(e.thread_ref,actor.id);return !!fresh&&!fresh.tombstones.has(e.message_ref)&&fresh.rows.some(x=>x.event_ref===e.event_ref);};
    const media=await loadBusinessMedia({config:c,row,index:Number(req.query.index),authorized});
    res.setHeader('Content-Type',media.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition','inline');return res.status(200).send(media.buffer);
   }
   return res.status(400).end();
  }catch(e){
   const diagnostic=env().VERCEL_ENV==='preview'&&req.query?.op==='oauth-complete'?businessOAuthDiagnostic(e):null;
   const safeHistory=new Set(['history_list_invalid_json','history_list_unavailable','history_detail_invalid_json','history_detail_unavailable','history_message_invalid_json','history_message_unavailable','history_not_durable','history_internal_credential','history_internal_list','history_internal_detail','history_internal_message','history_internal_persist']);
   if(req.query?.op==='history-sync'){
    const status=safeHistory.has(e?.message)?e.message:'history_unknown_stage';
    return res.status(503).json({status});
   }
   return res.status(503).json(diagnostic?{status:'oauth_verification_failed',diagnostic}:{status:'business_unavailable'});
  }
 };
}
