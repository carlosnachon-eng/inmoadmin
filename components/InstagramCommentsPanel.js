import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';

async function request(op,{body}={}){
 const {data}=await supabase.auth.getSession();
 if(!data?.session)throw Error('Sesión requerida');
 const r=await fetch('/api/operaciones/instagram-business?op='+op,{
  method:body?'POST':'GET',
  cache:'no-store',
  redirect:'error',
  headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 if(!r.ok){
  const j=await r.json().catch(()=>null);
  throw Error(j?.status||'comments_unavailable');
 }
 return r.json();
}

const STAMP=value=>new Intl.DateTimeFormat('es-MX',{
 timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'
}).format(new Date(value));

const CANNED=[
 '¡Claro! Envíanos mensaje por inbox y con gusto te compartimos toda la información 😊',
 'Con gusto. Mándanos DM y te compartimos precio, ubicación y disponibilidad 🙌'
];

export default function InstagramCommentsPanel({open,onClose}){
 const [rows,setRows]=useState([]);
 const [allowed,setAllowed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const [drafts,setDrafts]=useState({});
 const [sending,setSending]=useState(null);

 async function load(){
  setBusy(true);setStatus('');
  try{
   const r=await request('comments');
   setRows(r.rows||[]);
   setAllowed(r.comments_allowed===true);
   if(r.comments_allowed!==true)setStatus('Falta autorizar el permiso de comentarios de Instagram.');
  }catch(e){
   setRows([]);
   setStatus(e.message==='forbidden'?'Comentarios disponibles para Dirección/Gerencia de Ventas.':'No fue posible cargar comentarios.');
  }finally{setBusy(false);}
 }

 useEffect(()=>{if(open)void load();},[open]);

 async function reply(row){
  const text=String(drafts[row.comment_ref]||CANNED[0]).trim();
  if(!text||sending)return;
  setSending(row.comment_ref);setStatus('');
  try{
   const action=crypto.randomUUID();
   const r=await request('comment-reply',{body:{action,comment:row.comment_ref,text}});
   if(r.status==='accepted'){
    setStatus('Respuesta publicada en Instagram.');
    await load();
   }else if(r.status==='comments_permission_required'){
    setAllowed(false);
    setStatus('Falta autorizar el permiso de comentarios de Instagram.');
   }else{
    setStatus('No fue posible publicar la respuesta.');
   }
  }catch{setStatus('No fue posible publicar la respuesta.');}
  finally{setSending(null);}
 }

 if(!open)return null;
 return <div className="igCommentsBackdrop" onClick={onClose}>
  <section className="igCommentsPanel" onClick={e=>e.stopPropagation()}>
   <header>
    <div><strong>Comentarios de Instagram</strong><span>Separados de mensajes directos</span></div>
    <button type="button" onClick={onClose}>×</button>
   </header>

   <div className="igCommentsToolbar">
    <button type="button" onClick={load} disabled={busy}>{busy?'Actualizando…':'Actualizar'}</button>
    <span className={allowed?'ok':'warn'}>{allowed?'Permiso listo':'Permiso pendiente'}</span>
   </div>

   {status&&<p className="igCommentsStatus">{status}</p>}

   <div className="igCommentsList">
    {!busy&&!rows.length&&<div className="igCommentsEmpty">Todavía no hay comentarios recibidos por webhook.</div>}
    {rows.map(row=><article key={row.id} className="igCommentCard">
     <div className="igCommentMeta">
      <strong>{row.username?('@'+row.username):'Usuario de Instagram'}</strong>
      <span>{row.media_product_type||'Publicación'} · {STAMP(row.occurred_at)}</span>
     </div>
     <p>{row.text||'Comentario sin texto'}</p>
     {row.reply_status&&<small>Última respuesta: {row.reply_status}</small>}
     <div className="igCommentCanned">
      {CANNED.map((text,i)=><button key={i} type="button" onClick={()=>setDrafts(v=>({...v,[row.comment_ref]:text}))}>{i===0?'Inbox':'Precio/ubicación'}</button>)}
     </div>
     <textarea
      value={drafts[row.comment_ref]??CANNED[0]}
      onChange={e=>setDrafts(v=>({...v,[row.comment_ref]:e.target.value}))}
      maxLength={900}
      disabled={!allowed||sending===row.comment_ref}
     />
     <button
      type="button"
      className="igCommentReply"
      disabled={!allowed||sending===row.comment_ref}
      onClick={()=>reply(row)}
     >{sending===row.comment_ref?'Publicando…':'Responder públicamente'}</button>
    </article>)}
   </div>

   <style jsx>{`
    .igCommentsBackdrop{position:fixed;inset:0;z-index:1200;background:rgba(17,24,39,.52);display:flex;justify-content:flex-end}
    .igCommentsPanel{width:min(100%,560px);height:100%;background:#fff;display:flex;flex-direction:column;box-shadow:-10px 0 28px rgba(0,0,0,.18)}
    header{display:flex;align-items:center;justify-content:space-between;padding:18px;border-bottom:1px solid #e5e7eb}
    header strong{display:block;font-size:18px} header span{display:block;font-size:11px;color:#9ca3af;margin-top:2px}
    header button{border:0;background:#f3f4f6;width:34px;height:34px;border-radius:50%;font-size:22px}
    .igCommentsToolbar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #f3f4f6}
    .igCommentsToolbar button{border:1px solid #d1d5db;background:#fff;border-radius:9px;padding:8px 10px;font-weight:800}
    .igCommentsToolbar span{font-size:10px;font-weight:900;border-radius:999px;padding:5px 8px}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}
    .igCommentsStatus{margin:10px 18px 0;padding:9px 10px;background:#f9fafb;border-radius:9px;font-size:11px;color:#6b7280}
    .igCommentsList{padding:14px 18px 24px;overflow-y:auto;display:grid;gap:12px}
    .igCommentsEmpty{padding:38px 12px;text-align:center;color:#9ca3af}
    .igCommentCard{border:1px solid #e5e7eb;border-radius:13px;padding:12px;display:grid;gap:9px}
    .igCommentMeta{display:flex;justify-content:space-between;gap:8px}.igCommentMeta strong{font-size:12px}.igCommentMeta span{font-size:10px;color:#9ca3af;text-align:right}
    .igCommentCard p{margin:0;font-size:14px;line-height:1.4}.igCommentCard small{font-size:10px;color:#6b7280}
    .igCommentCanned{display:flex;gap:6px;flex-wrap:wrap}.igCommentCanned button{border:0;background:#fce8ed;color:#b91c3c;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:800}
    textarea{width:100%;box-sizing:border-box;min-height:78px;resize:vertical;border:1px solid #d1d5db;border-radius:10px;padding:9px;font:inherit;font-size:12px}
    .igCommentReply{justify-self:end;border:0;background:#b91c3c;color:#fff;border-radius:9px;padding:9px 12px;font-weight:800}.igCommentReply:disabled{opacity:.45}
    @media(max-width:760px){.igCommentsPanel{width:100%}}
   `}</style>
  </section>
 </div>;
}
