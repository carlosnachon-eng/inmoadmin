import {useEffect,useMemo,useState} from 'react';
import {supabase} from '../lib/supabase';

async function request(op,{body}={}){
 const {data}=await supabase.auth.getSession();
 if(!data?.session)throw Error('Sesión requerida');
 const r=await fetch('/api/operaciones/instagram-business?op='+op,{
  method:body?'POST':'GET',cache:'no-store',redirect:'error',
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
 const [selected,setSelected]=useState(null);
 const [search,setSearch]=useState('');
 const [kind,setKind]=useState('all');

 async function load(){
  setBusy(true);setStatus('');
  try{
   const r=await request('comments');
   const next=r.rows||[];
   setRows(next);
   setAllowed(r.comments_allowed===true);
   setSelected(current=>next.some(x=>x.comment_ref===current)?current:(next[0]?.comment_ref||null));
   if(r.comments_allowed!==true)setStatus('Falta autorizar el permiso de comentarios de Instagram.');
  }catch(e){
   setRows([]);setSelected(null);
   setStatus(e.message==='forbidden'?'Comentarios disponibles para Dirección/Gerencia de Ventas.':'No fue posible cargar comentarios.');
  }finally{setBusy(false);}
 }

 useEffect(()=>{if(open)void load();},[open]);

 const filtered=useMemo(()=>{
  const q=search.trim().toLowerCase();
  return rows.filter(r=>{
   const type=String(r.media_product_type||'').toLowerCase();
   if(kind==='reels'&&!type.includes('reel'))return false;
   if(kind==='posts'&&type.includes('reel'))return false;
   if(!q)return true;
   return [r.username,r.text,r.media_product_type].some(v=>String(v||'').toLowerCase().includes(q));
  });
 },[rows,search,kind]);

 const active=rows.find(r=>r.comment_ref===selected)||filtered[0]||null;

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
    setAllowed(false);setStatus('Falta autorizar el permiso de comentarios de Instagram.');
   }else setStatus('No fue posible publicar la respuesta.');
  }catch{setStatus('No fue posible publicar la respuesta.');}
  finally{setSending(null);}
 }

 if(!open)return null;
 return <section className="commentsInbox" aria-label="Comentarios de Instagram">
  <aside className="commentListPane">
   <header className="listHeader">
    <div><strong>Comentarios</strong><span>Instagram</span></div>
    <div className="headerActions">
     <button type="button" onClick={load} disabled={busy} title="Actualizar">↻</button>
     <button type="button" onClick={onClose} title="Volver a mensajes">×</button>
    </div>
   </header>

   <div className="channelTabs">
    <button type="button" className="channel" onClick={onClose}>◎ Instagram</button>
    <button type="button" className="channel active">💬 Comentarios</button>
    <button type="button" className="channel" disabled>f Facebook <small>próximamente</small></button>
   </div>

   <div className="searchWrap"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar comentarios"/></div>
   <div className="filters">
    <button className={kind==='all'?'active':''} onClick={()=>setKind('all')}>Todos</button>
    <button className={kind==='reels'?'active':''} onClick={()=>setKind('reels')}>Reels</button>
    <button className={kind==='posts'?'active':''} onClick={()=>setKind('posts')}>Publicaciones</button>
   </div>

   <div className="permissionRow"><span className={allowed?'ok':'warn'}>{allowed?'Permiso listo':'Permiso pendiente'}</span><small>{filtered.length} comentario{filtered.length===1?'':'s'}</small></div>
   {status&&<p className="status">{status}</p>}

   <div className="commentRows">
    {busy&&!rows.length&&<div className="empty">Cargando comentarios…</div>}
    {!busy&&!filtered.length&&<div className="empty">No hay comentarios para este filtro.</div>}
    {filtered.map(row=><button type="button" key={row.id} className={`commentRow ${active?.comment_ref===row.comment_ref?'selected':''}`} onClick={()=>setSelected(row.comment_ref)}>
      <div className="rowTop"><strong>{row.username?('@'+row.username):'Usuario de Instagram'}</strong><time>{STAMP(row.occurred_at)}</time></div>
      <p>{row.text||'Comentario sin texto'}</p>
      <small>{row.media_product_type||'Publicación'}</small>
    </button>)}
   </div>
  </aside>

  <main className="commentDetailPane">
   {active?<>
    <header className="detailHeader">
     <button type="button" className="mobileBack" onClick={()=>setSelected(null)}>‹</button>
     <div><strong>{active.username?('@'+active.username):'Usuario de Instagram'}</strong><span>{active.media_product_type||'Publicación'} · {STAMP(active.occurred_at)}</span></div>
    </header>
    <div className="detailScroll">
     <section className="originalComment">
      <small>Comentario recibido</small>
      <p>{active.text||'Comentario sin texto'}</p>
     </section>

     <section className="replyBox">
      <div className="replyHead"><strong>Responder públicamente</strong><span>Manual · IA desactivada</span></div>
      <div className="canned">
       {CANNED.map((text,i)=><button key={i} type="button" onClick={()=>setDrafts(v=>({...v,[active.comment_ref]:text}))}>{i===0?'Enviar a inbox':'Precio / ubicación'}</button>)}
      </div>
      <textarea value={drafts[active.comment_ref]??CANNED[0]} onChange={e=>setDrafts(v=>({...v,[active.comment_ref]:e.target.value}))} maxLength={900} disabled={!allowed||sending===active.comment_ref}/>
      <div className="replyFooter">
       <span>{(drafts[active.comment_ref]??CANNED[0]).length}/900</span>
       <button type="button" className="replyButton" disabled={!allowed||sending===active.comment_ref} onClick={()=>reply(active)}>{sending===active.comment_ref?'Publicando…':'Responder públicamente'}</button>
      </div>
     </section>
    </div>
   </>:<div className="emptyDetail"><div>💬</div><strong>Selecciona un comentario</strong><span>Elige uno de la lista para revisarlo y responder.</span></div>}
  </main>

  <style jsx>{`
   .commentsInbox{height:calc(100dvh - 112px);max-height:calc(100dvh - 112px);display:grid;grid-template-columns:340px minmax(0,1fr);background:#fff;border-top:1px solid #e5e7eb;overflow:hidden}
   .commentListPane{min-width:0;display:flex;flex-direction:column;border-right:1px solid #e5e7eb;overflow:hidden}
   .listHeader,.detailHeader{height:68px;box-sizing:border-box;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb}
   .listHeader strong,.detailHeader strong{display:block;font-size:18px}.listHeader span,.detailHeader span{display:block;color:#9ca3af;font-size:11px;margin-top:2px}
   .headerActions{display:flex;gap:7px}.headerActions button,.mobileBack{width:34px;height:34px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;cursor:pointer;font-size:18px}
   .channelTabs{display:flex;gap:6px;padding:12px 14px 6px;overflow-x:auto}.channel{border:0;background:#f3f4f6;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;color:#6b7280;white-space:nowrap;cursor:pointer}.channel.active{background:#fce8ed;color:#b91c3c}.channel small{font-size:9px}
   .searchWrap{margin:8px 14px;background:#f3f4f6;border-radius:10px;padding:9px 12px;display:flex;gap:8px;align-items:center}.searchWrap input{width:100%;border:0;outline:0;background:transparent;font-size:13px}
   .filters{display:flex;gap:6px;padding:0 14px 10px;overflow-x:auto}.filters button{border:0;background:#f3f4f6;color:#6b7280;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:800;white-space:nowrap;cursor:pointer}.filters button.active{background:#fce8ed;color:#b91c3c}
   .permissionRow{display:flex;align-items:center;justify-content:space-between;padding:0 14px 10px}.permissionRow span{font-size:10px;font-weight:900;border-radius:999px;padding:5px 8px}.permissionRow small{font-size:10px;color:#9ca3af}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}
   .status{margin:0 14px 10px;padding:8px 9px;background:#f9fafb;border-radius:9px;font-size:11px;color:#6b7280}
   .commentRows{min-height:0;overflow-y:auto;flex:1}.commentRow{width:100%;border:0;border-top:1px solid #f3f4f6;background:#fff;padding:13px 14px;text-align:left;cursor:pointer}.commentRow:hover,.commentRow.selected{background:#f9fafb}.commentRow.selected{box-shadow:inset 3px 0 #b91c3c}.rowTop{display:flex;justify-content:space-between;gap:8px}.rowTop strong{font-size:12px}.rowTop time{font-size:9px;color:#9ca3af;text-align:right}.commentRow p{margin:5px 0 4px;font-size:12px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.commentRow small{font-size:9px;color:#9ca3af;text-transform:uppercase}
   .commentDetailPane{min-width:0;display:flex;flex-direction:column;background:#f9fafb}.detailHeader{justify-content:flex-start;gap:8px;background:#fff}.mobileBack{display:none}
   .detailScroll{overflow-y:auto;padding:28px;display:grid;gap:18px}.originalComment,.replyBox{max-width:760px;width:100%;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;box-sizing:border-box}.originalComment small{font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:800}.originalComment p{font-size:18px;line-height:1.5;margin:10px 0 0}
   .replyHead{display:flex;justify-content:space-between;gap:10px;align-items:center}.replyHead strong{font-size:14px}.replyHead span{font-size:10px;color:#9ca3af}.canned{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 10px}.canned button{border:0;background:#fce8ed;color:#b91c3c;border-radius:999px;padding:7px 10px;font-size:10px;font-weight:800;cursor:pointer}
   textarea{width:100%;box-sizing:border-box;min-height:140px;resize:vertical;border:1px solid #d1d5db;border-radius:11px;padding:12px;font:inherit;font-size:13px}.replyFooter{display:flex;justify-content:space-between;align-items:center;margin-top:10px}.replyFooter span{font-size:10px;color:#9ca3af}.replyButton{border:0;background:#b91c3c;color:#fff;border-radius:9px;padding:10px 13px;font-weight:800;cursor:pointer}.replyButton:disabled{opacity:.45}
   .empty,.emptyDetail{color:#9ca3af;text-align:center}.empty{padding:38px 12px}.emptyDetail{margin:auto;display:grid;gap:6px}.emptyDetail div{font-size:38px}.emptyDetail strong{color:#6b7280}.emptyDetail span{font-size:12px}
   @media(max-width:760px){.commentsInbox{height:calc(100dvh - 56px);max-height:calc(100dvh - 56px);grid-template-columns:1fr}.commentListPane{display:${selected?'none':'flex'}}.commentDetailPane{display:${selected?'flex':'none'}}.mobileBack{display:block}.detailScroll{padding:16px}.originalComment p{font-size:16px}.replyHead{align-items:flex-start;flex-direction:column}}
  `}</style>
 </section>;
}
