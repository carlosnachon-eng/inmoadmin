import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {sameOriginAdminRequest} from '../../../lib/shadow/identityBootstrap.js';
import {messengerConfig,isRef,isUuid} from '../../../lib/messaging/facebook/messenger/config.js';
import {COMMERCIAL_INBOX_ROLES} from '../../../lib/messaging/shared/channelPermissions.js';

const normalizePhone=x=>String(x||'').replace(/\D/g,'').slice(-10);
const mxDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
async function syncKpis(db,advisorId,fechaHora){
 const date=mxDate(fechaHora),next=new Date(date+'T12:00:00-06:00');next.setDate(next.getDate()+1);
 const end=mxDate(next);
 const [{data:profile},{data:appointments}]=await Promise.all([
  db.from('profiles').select('email,full_name').eq('id',advisorId).maybeSingle(),
  db.from('citas').select('estado,fecha_hora').eq('asesor_id',advisorId).gte('fecha_hora',date+'T00:00:00-06:00').lt('fecha_hora',end+'T00:00:00-06:00')
 ]);
 if(!profile?.email||!appointments)return false;
 const rows=appointments.filter(x=>mxDate(x.fecha_hora)===date&&x.estado!=='cancelada');
 const values={citas_agendadas:rows.length,citas_efectivas:rows.filter(x=>['efectiva','calificada'].includes(x.estado)).length,citas_calificadas:rows.filter(x=>x.estado==='calificada').length};
 const {data:existing,error}=await db.from('kpis_diarios').select('id').eq('email',profile.email).eq('fecha',date).maybeSingle();
 if(error)return false;
 const result=existing?await db.from('kpis_diarios').update(values).eq('id',existing.id):
  await db.from('kpis_diarios').insert({...values,fecha:date,asesor:profile.full_name||profile.email,email:profile.email});
 return !result.error;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 if(req.method==='POST'&&!sameOriginAdminRequest(req))return res.status(403).end();
 try{
  const c=messengerConfig(process.env),actor=await authorizeInboxStaff(req);
  if(!c||!actor?.active||!COMMERCIAL_INBOX_ROLES.includes(actor.role_id))return res.status(403).end();
  const op=req.method==='GET'?'list':req.query?.op;
  const thread=req.method==='GET'?req.query?.thread:req.body?.thread;
  if(!isRef(thread))return res.status(400).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:history,error:he}=await db.rpc('fb_messenger_inbox_v1',{p_connection:c.connection,p_actor:actor.id,p_thread:thread});
  if(he||!history||!Array.isArray(history.rows))return res.status(403).end();
  const {data:link,error:le}=await db.rpc('fb_messenger_thread_client_v1',{p_connection:c.connection,p_thread:thread,p_actor:actor.id,p_op:'get',p_client:null});
  if(le)return res.status(403).end();
  if(op==='list'){
   if(!link?.client_id)return res.status(200).json({rows:[]});
   const {data,error}=await db.from('citas').select('id,cliente_id,asesor_id,propiedad_id,fecha_hora,estado,notas').eq('cliente_id',link.client_id).order('fecha_hora',{ascending:false}).limit(30);
   if(error)throw Error('list');
   return res.status(200).json({rows:data||[]});
  }
  if(op==='create'){
   const b=req.body;
   if(Object.keys(b||{}).sort().join(',')!=='advisor_id,email,fecha_hora,name,notas,phone,property_id,thread'||
    !isUuid(b.advisor_id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>120||
    typeof b.phone!=='string'||b.phone.length>32||typeof b.email!=='string'||b.email.length>254||
    typeof b.notas!=='string'||b.notas.length>500||!Number.isFinite(Date.parse(b.fecha_hora))||
    (b.property_id!==null&&!isUuid(b.property_id)))return res.status(400).end();
   const {data:advisor}=await db.from('profiles').select('id,active,role_id').eq('id',b.advisor_id).maybeSingle();
   if(!advisor?.active||!['asesor','gerente_ventas','admin'].includes(advisor.role_id))return res.status(400).json({status:'advisor_invalid'});
   if(b.property_id){
    const {data:p}=await db.from('propiedades').select('id,status').eq('id',b.property_id).maybeSingle();
    if(p?.status!=='published')return res.status(400).json({status:'property_invalid'});
   }
   let clientId=link?.client_id;
   if(!clientId){
    const {data:client,error}=await db.from('clientes').insert({nombre:b.name.trim(),telefono:normalizePhone(b.phone)||null,correo:b.email.trim().toLowerCase()||null,asesor_id:b.advisor_id}).select('id').single();
    if(error)throw Error('client');
    clientId=client.id;
    const {error:mapError}=await db.rpc('fb_messenger_thread_client_v1',{p_connection:c.connection,p_thread:thread,p_actor:actor.id,p_op:'set',p_client:clientId});
    if(mapError)throw Error('link');
   }
   const {data:appointment,error}=await db.from('citas').insert({cliente_id:clientId,propiedad_id:b.property_id,asesor_id:b.advisor_id,fecha_hora:b.fecha_hora,estado:'agendada',notas:b.notas.trim()||null}).select('id,asesor_id,fecha_hora').single();
   if(error)throw Error('appointment');
   return res.status(200).json({status:'created',appointment_id:appointment.id,kpi_synced:await syncKpis(db,appointment.asesor_id,appointment.fecha_hora)});
  }
  if(op==='cancel'){
   if(Object.keys(req.body||{}).sort().join(',')!=='appointment_id,thread'||!isUuid(req.body.appointment_id)||!link?.client_id)return res.status(400).end();
   const {data:a}=await db.from('citas').select('id,asesor_id,fecha_hora,estado').eq('id',req.body.appointment_id).eq('cliente_id',link.client_id).maybeSingle();
   if(!a)return res.status(404).end();
   if(a.estado!=='cancelada'){const {error}=await db.from('citas').update({estado:'cancelada'}).eq('id',a.id);if(error)throw Error('cancel');}
   return res.status(200).json({status:'cancelled',kpi_synced:await syncKpis(db,a.asesor_id,a.fecha_hora)});
  }
  return res.status(400).end();
 }catch{return res.status(503).json({status:'appointment_unavailable'});}
}
