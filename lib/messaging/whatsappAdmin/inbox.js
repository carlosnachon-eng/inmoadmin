// Gated read-only adapter over the existing Administration-scoped read RPCs.
// No Graph client, credentials, onboarding, claims or sender dependencies.
export function whatsappAdminPreviewAllowed(env=process.env){
 try{
  const host=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  if(['preview','development'].includes(env.VERCEL_ENV))return host==='hjfwjnejbcpmknvfpdcq.supabase.co';
  return env.VERCEL_ENV==='production' && env.WHATSAPP_ADMIN_READONLY_PRODUCTION_ENABLED==='true'
   &&host==='bnzrnizrmonjxlktbhlp.supabase.co';
 }catch{return false;}
}

export function whatsappAdminSource(env=process.env){
 if(!whatsappAdminPreviewAllowed(env))return null;
 return env.VERCEL_ENV==='production'
  ?{environment:'production',project_ref:'bnzrnizrmonjxlktbhlp',scope:'whatsapp_administracion'}
  :{environment:'dev',project_ref:'hjfwjnejbcpmknvfpdcq',scope:'whatsapp_administracion'};
}

export function createWhatsAppAdminHandler({authorize,reader,allowed,source=()=>whatsappAdminSource(process.env)}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(!allowed())return res.status(404).json({error:'channel_unavailable'});
  if(req.method!=='GET')return res.status(405).json({error:'read_only'});
  try{
   const actor=await authorize(req);
   if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))
    return res.status(403).json({error:'forbidden'});
   const q=req.query||{};
   if(Object.keys(q).some(k=>!['op','thread','before'].includes(k))
    ||Object.values(q).some(v=>typeof v!=='string')
    ||!['threads','history'].includes(q.op)
    ||(q.op==='threads'&&q.thread)||(q.op==='history'&&(!q.thread||q.before)))
    return res.status(400).json({error:'invalid_request'});
   const source=reader();
   const dataSource=source();
   if(!dataSource)return res.status(404).json({error:'channel_unavailable'});
   const status={mode:'read_only',connection:'not_certified',sender:false,onboarding:false,
    data_source:dataSource};
   if(q.op==='threads'){
    const rows=await source.list(q.before??null);
    const projected=[];
    // Bounded concurrency; preview uses exactly the same evidence/role gates as history.
    for(let i=0;i<rows.length;i+=4){
     projected.push(...await Promise.all(rows.slice(i,i+4).map(async r=>{
      const detail=await source.detail(r.input_id);
      const latest=detail.messages.at(-1);
      return {thread_ref:r.input_id,last_activity:r.last_activity,alias:r.label,
       preview:latest?.modified?'Mensaje modificado o anulado':latest?.text?.replace(/\s+/g,' ').slice(0,110)
        ||'Contenido no disponible',identity_state:r.identity_state};
     })));
    }
    return res.status(200).json({status,rows:projected,page_limit:30});
   }
   const detail=await source.detail(q.thread);
   const seen=new Map();
   for(const message of detail.messages){
    if(seen.has(message.message_ref)&&JSON.stringify(seen.get(message.message_ref))!==JSON.stringify(message))
     throw Error('history_conflict');
    seen.set(message.message_ref,message);
   }
   return res.status(200).json({status,thread_ref:detail.input_id,identity_state:detail.identity_state,
    rows:[...seen.values()],history_truncated:detail.history_truncated,
    capabilities:{assignments:false,appointments:false,properties:false,media_download:false}});
  }catch{return res.status(503).json({error:'stored_history_unavailable'});}
 };
}
