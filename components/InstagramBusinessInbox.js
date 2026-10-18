import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {submitBusinessReply} from '../lib/messaging/instagram/business/replyResult';

async function request(op,{query={},body,binary=false}={}){
 const {data}=await supabase.auth.getSession();
 if(!data?.session)throw Error('Sesión requerida');
 const r=await fetch('/api/operaciones/instagram-business?'+new URLSearchParams({op,...query}),{
  method:body?'POST':'GET',cache:'no-store',redirect:'error',
  headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 if(!r.ok){
  if(!binary){try{const j=await r.json();if(typeof j?.status==='string')throw Error(j.status);}catch(e){if(e?.message&&e.message!=='Unexpected end of JSON input')throw e;}}
  throw Error('Instagram no disponible');
 }
 return binary?r.blob():r.json();
}

const clock=value=>new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const day=value=>new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',day:'2-digit',month:'short'}).format(new Date(value));

function Media({thread,input,index}){
 const [url,setUrl]=useState(null);
 useEffect(()=>{
  let active=true,object;
  request('media',{query:{thread,input,index:String(index)},binary:true})
   .then(blob=>{object=URL.createObjectURL(blob);if(active)setUrl(object);else URL.revokeObjectURL(object);})
   .catch(()=>{});
  return()=>{active=false;if(object)URL.revokeObjectURL(object);};
 },[thread,input,index]);
 return url?<img src={url} alt="Imagen recibida en Instagram" className="inboxMedia"/>:<div className="mediaPlaceholder">Imagen no disponible</div>;
}

export default function InstagramBusinessInbox(){
 const [threads,setThreads]=useState([]);
 const [selected,setSelected]=useState(null);
 const [rows,setRows]=useState([]);
 const [text,setText]=useState('');
 const [input,setInput]=useState(null);
 const [enabled,setEnabled]=useState(false);
 const [status,setStatus]=useState('');
 const [historyStatus,setHistoryStatus]=useState('');
 const [busy,setBusy]=useState(false);
 const [search,setSearch]=useState('');
 const [aliasDraft,setAliasDraft]=useState(''),[aliasBusy,setAliasBusy]=useState(false);
 const [profile,setProfile]=useState(null),[syncing,setSyncing]=useState(false),[uncertainLocked,setUncertainLocked]=useState(false);
 const lock=useRef(false),generation=useRef(0),chatRef=useRef(null),polling=useRef(false),selectedRef=useRef(null);

 const filtered=useMemo(()=>{
  const q=search.trim().toLowerCase();
  if(!q)return threads;
  return threads.filter((t,i)=>`instagram conversación ${i+1} ${t.thread_ref} ${t.alias||''} ${t.profile_name||''} ${t.profile_username||''}`.toLowerCase().includes(q));
 },[threads,search]);

 async function load(thread,{quiet=false}={}){
  if(lock.current)return;
  const gen=++generation.current;
  if(!quiet)setBusy(true);
  if(!quiet)setStatus('');
  try{
   const r=await request(thread?'history':'threads',{query:thread?{thread}:{}});
   if(gen!==generation.current)return;
   setEnabled(!!r.sender_enabled);
   if(thread){
    setRows(r.rows||[]);
    setSelected(thread);
    setProfile(r.profile||null);
    if(r.profile) setThreads(list=>list.map(t=>t.thread_ref===thread?{...t,profile_name:r.profile.name||null,profile_username:r.profile.username||null,profile_pic:r.profile.profile_pic||null}:t));
    const current=threads.find(t=>t.thread_ref===thread);
    setAliasDraft(current?.alias||'');
    setInput(null);
    setUncertainLocked(false);
    setText('');
    requestAnimationFrame(()=>chatRef.current?.scrollTo({top:chatRef.current.scrollHeight,behavior:'smooth'}));
   }else{
    setThreads(r.rows||[]);
    if(!selected&&r.rows?.length){if(!quiet)setBusy(false);void load(r.rows[0].thread_ref,{quiet:true});}
   }
  }catch(e){if(gen===generation.current)setStatus(e.message);}
  finally{if(gen===generation.current&&!quiet)setBusy(false);}
 }

 useEffect(()=>{selectedRef.current=selected;},[selected]);
 useEffect(()=>{void load();},[]);
 useEffect(()=>{
  const tick=async()=>{
   if(polling.current||lock.current||document.visibilityState!=='visible')return;
   polling.current=true;
   try{
    const t=await request('threads');
    setEnabled(!!t.sender_enabled);
    setThreads(t.rows||[]);
    const current=selectedRef.current;
    if(current){
     const h=await request('history',{query:{thread:current}});
     setEnabled(!!h.sender_enabled);
     setRows(h.rows||[]);
     setProfile(h.profile||null);
     if(h.profile)setThreads(list=>list.map(x=>x.thread_ref===current?{...x,profile_name:h.profile.name||null,profile_username:h.profile.username||null,profile_pic:h.profile.profile_pic||null}:x));
    }
   }catch{/* Keep the current Inbox visible; manual refresh can surface errors. */}
   finally{polling.current=false;}
  };
  const id=setInterval(tick,15000);
  return()=>clearInterval(id);
 },[]);

 async function syncHistory(){
  if(syncing)return;
  setSyncing(true);setHistoryStatus('Recuperando historial reciente…');
  try{
   const r=await request('history-sync',{body:{}});
   setHistoryStatus(`Meta encontró ${r.conversation_candidates??r.conversations??0} conversaciones · ${r.scanned??0} mensajes revisados · ${r.inserted??0} nuevos · ${r.duplicates??0} ya existentes${r.truncated_to_recent_20?' · algunas conversaciones exceden los 20 mensajes recuperables':''}`);
   await load(null,{quiet:true});
   if(selected)await load(selected,{quiet:true});
  }catch(e){
   try{
    const msg=String(e?.message||'');
    setHistoryStatus(msg.includes('history_list')?'Meta no permitió listar conversaciones':msg.includes('history_detail')?'Meta listó conversaciones pero no permitió leer sus mensajes':msg.includes('history_message')?'Meta permitió listar el hilo pero no leer uno de sus mensajes':'No fue posible recuperar el historial reciente');
   }catch{setHistoryStatus('No fue posible recuperar el historial reciente');}
  }
  finally{setSyncing(false);}
 }

 async function saveAlias(){
  if(!selected||aliasBusy)return;
  setAliasBusy(true);setStatus('');
  try{
   const r=await request('alias-set',{body:{thread:selected,alias:aliasDraft}});
   setAliasDraft(r.alias||'');
   setThreads(list=>list.map(t=>t.thread_ref===selected?{...t,alias:r.alias||null}:t));
   setStatus(r.alias?'Nombre guardado':'Nombre eliminado');
  }catch{setStatus('No fue posible guardar el nombre');}
  finally{setAliasBusy(false);}
 }

 const eligibleInbound=[...rows].reverse().find(r=>r.direction==='customer_inbound'&&!r.deleted&&Date.now()-Date.parse(r.occurred_at)>=0&&Date.now()-Date.parse(r.occurred_at)<23*3600000)||null;
 const replyAnchor=input||eligibleInbound?.input||null;

 async function send(e){
  e.preventDefault();
  if(lock.current||!enabled||!replyAnchor||!text.trim()||uncertainLocked)return;
  lock.current=true;
  setBusy(true);
  setStatus('Enviando…');
  const action=crypto.randomUUID();
  try{
   const r=await submitBusinessReply({request,thread:selected,input:replyAnchor,action,text:text.trim()});
   if(r.status==='accepted'){
    setStatus('Enviado');setText('');setInput(null);setUncertainLocked(false);
    await load(selected,{quiet:true});await load(null,{quiet:true});
   }else if(r.status==='uncertain'){
    setUncertainLocked(true);setStatus('Resultado incierto · revisa Instagram antes de enviar otro mensaje');
   }else{
    const validation=r?.diagnostic?.validation;
    setStatus(validation?`${r.status} · ${validation}`:r.source==='journal'?`${r.status} · confirmado en journal`:r.status);
   }
  }catch(e){
   const reason=String(e?.message||'');
   if(reason==='origin_denied'){setStatus('Bloqueado por validación de origen');}
   else {setUncertainLocked(true);setStatus('Resultado incierto · revisa Instagram antes de enviar otro mensaje');}
  }finally{lock.current=false;setBusy(false);}
 }

 const selectedIndex=Math.max(0,threads.findIndex(t=>t.thread_ref===selected));
 const replyTarget=input?rows.find(r=>r.input===input):null;

 return <section aria-label="Instagram Business Inbox" className="inboxShell">
  <aside className="conversationPane">
   <div className="paneHeader">
    <div><h2>Inbox</h2><span>Instagram</span></div>
    <div className="headerActions"><button className="historyButton" disabled={busy||syncing} onClick={syncHistory}>{syncing?'Recuperando…':'7 días'}</button><button className="iconButton" title="Actualizar" disabled={busy||syncing} onClick={()=>load()}>↻</button></div>
   </div>
   {historyStatus&&<div className="historyStatus" role="status">{historyStatus}</div>}
   <div className="channelTabs">
    <button className="channel active"><span className="igDot">◎</span> Instagram</button>
    <button className="channel" disabled><span>f</span> Facebook <small>próximamente</small></button>
   </div>
   <div className="searchWrap"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar conversaciones"/></div>
   <div className="threadList" aria-label="Conversaciones Instagram">
    {busy&&!threads.length&&<div className="emptyList">Cargando conversaciones…</div>}
    {!busy&&!threads.length&&!status&&<div className="emptyList">No hay conversaciones disponibles.</div>}
    {filtered.map((t,i)=>{
     const active=t.thread_ref===selected;
     const n=threads.indexOf(t)+1;
     return <button key={t.thread_ref} className={`threadCard ${active?'selected':''}`} onClick={()=>load(t.thread_ref)} disabled={busy}>
      {t.profile_pic?<img src={t.profile_pic} alt="" className="threadAvatarPic"/>:<div className="avatar">IG</div>}
      <div className="threadCopy">
       <div className="threadTop"><strong>{t.alias||(t.profile_username?`@${t.profile_username}`:t.profile_name)||`Conversación Instagram ${n}`}</strong><time>{clock(t.last_activity)}</time></div>
       <p>Mensaje directo de Instagram</p>
       <small>{day(t.last_activity)}</small>
      </div>
     </button>;
    })}
   </div>
  </aside>

  <main className="chatPane">
   {selected?<>
    <header className="chatHeader">
     <button type="button" className="backButton" onClick={()=>{setSelected(null);setRows([]);setProfile(null);setInput(null);}}>‹</button>
     <div className="contactTitle"><div className="avatar large">IG</div><div><strong>{threads.find(t=>t.thread_ref===selected)?.alias||(profile?.username?`@${profile.username}`:profile?.name)||`Conversación Instagram ${selectedIndex+1}`}</strong><span>{profile?.username&&profile?.name?`${profile.name} · `:''}Instagram · Meta directo</span></div></div>
     <div className={`senderBadge ${enabled?'on':'off'}`}>{enabled?'Envío habilitado':'Sender OFF'}</div>
    </header>
    <div className="messages" ref={chatRef}>
     {rows.map(r=>{
      const inbound=r.direction==='customer_inbound';
      return <div key={r.input} className={`messageRow ${inbound?'incoming':'outgoing'}`}>
       <article className="bubble">
        {r.attachments?.map(a=>a.type==='image'?<Media key={a.index} thread={selected} input={r.input} index={a.index}/>:<div key={a.index} className="mediaPlaceholder">Adjunto no soportado</div>)}
        {r.text&&<p>{r.text}</p>}
        <div className="bubbleMeta"><time>{clock(r.occurred_at)}</time>{r.status&&<span> · {r.status}</span>}</div>
       </article>
       {inbound&&!r.deleted&&<button className="replyChip" disabled={busy||uncertainLocked} onClick={()=>setInput(r.input)}>{input===r.input?'✓ Respondiendo aquí':'Responder aquí'}</button>}
      </div>;
     })}
    </div>
    <form className="composer" onSubmit={send}>
     {replyTarget&&<div className="replyContext"><span>Respondiendo al mensaje de las {clock(replyTarget.occurred_at)}</span><button type="button" onClick={()=>setInput(null)}>×</button></div>}
     <div className="composerRow">
      <textarea id="business-reply" value={text} onChange={e=>setText(e.target.value)} maxLength={999}
       placeholder={!enabled?'Sender apagado':uncertainLocked?'Verifica el último envío antes de continuar':replyAnchor?'Escribe un mensaje…':'Fuera de la ventana de respuesta'}
       disabled={busy||!enabled||!replyAnchor||uncertainLocked}/>
      <button className="sendButton" disabled={busy||!enabled||!replyAnchor||!text.trim()||uncertainLocked}>Enviar</button>
     </div>
     <div className="composerFoot"><span>{status||(replyAnchor?'Ventana de respuesta activa · sin IA automática':'Sin mensaje entrante elegible en las últimas 23 h')}</span><span>{text.length}/999</span></div>
    </form>
   </>:<div className="emptyChat"><div className="emptyIcon">💬</div><h3>Selecciona una conversación</h3><p>Los mensajes de Instagram aparecerán aquí automáticamente.</p></div>}
  </main>

  <aside className="detailsPane">
   <div className="detailsHeader"><h3>Detalles</h3></div>
   {selected?<div className="detailsBody">
    <div className="profileCard">{profile?.profile_pic?<img src={profile.profile_pic} alt="" className="profilePic"/>:<div className="avatar xlarge">IG</div>}<strong>{threads.find(t=>t.thread_ref===selected)?.alias||(profile?.username?`@${profile.username}`:profile?.name)||'Contacto de Instagram'}</strong><span>{threads.find(t=>t.thread_ref===selected)?.alias?(profile?.username?`Instagram: @${profile.username}`:'Alias interno de Emporio'):(profile?.name||'Identidad no disponible')}</span></div>
    <div className="detailBlock"><label>Nombre interno</label><div className="aliasEditor"><input value={aliasDraft} onChange={e=>setAliasDraft(e.target.value)} maxLength={80} placeholder="Ej. Cliente Depa Angelópolis"/><button disabled={aliasBusy} onClick={saveAlias}>{aliasBusy?'…':'Guardar'}</button></div><small>Visible sólo dentro de Inmoadmin; no cambia el nombre en Instagram.</small></div>
    <div className="detailBlock"><label>Canal</label><p>Instagram Direct</p></div>
    <div className="detailBlock"><label>Estado</label><p>{enabled?'Atención manual habilitada':'Lectura disponible · sender OFF'}</p></div>
    <div className="detailBlock"><label>Seguridad</label><p>Contenido y destinatario cifrados. Sin reintentos automáticos.</p></div>
    <div className="detailBlock muted"><p>Facebook/Messenger se incorporará aquí como segundo canal, sin crear otra bandeja.</p></div>
   </div>:<div className="detailsBody muted">Selecciona una conversación para ver su contexto.</div>}
  </aside>

  {status&&status.includes('no disponible')&&<div className="globalError" role="alert">{status}</div>}

  <style jsx>{`
   .inboxShell{height:calc(100vh - 62px);min-height:620px;background:#fff;display:grid;grid-template-columns:320px minmax(420px,1fr) 280px;border-top:1px solid #e5e7eb;color:#1f2937}
   .conversationPane,.detailsPane{min-width:0;background:#fff}.conversationPane{border-right:1px solid #e5e7eb;display:flex;flex-direction:column}.detailsPane{border-left:1px solid #e5e7eb}
   .paneHeader,.chatHeader,.detailsHeader{height:68px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb;box-sizing:border-box}
   .paneHeader h2{margin:0;font-size:22px}.paneHeader span,.contactTitle span{display:block;color:#6b7280;font-size:12px;margin-top:2px}
   .headerActions{display:flex;gap:7px;align-items:center}.historyButton{height:34px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;padding:0 10px;font-size:11px;font-weight:800;color:#4b5563;cursor:pointer}.iconButton{width:34px;height:34px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;font-size:18px;cursor:pointer}
   .channelTabs{display:flex;gap:6px;padding:12px 14px 6px}.channel{border:0;background:#f3f4f6;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;color:#6b7280}.channel.active{background:#fce8ed;color:#b91c3c}.channel small{font-size:9px;font-weight:600}.igDot{font-size:16px}
   .searchWrap{margin:8px 14px 12px;background:#f3f4f6;border-radius:10px;padding:9px 12px;display:flex;gap:8px;align-items:center}.searchWrap input{width:100%;border:0;outline:0;background:transparent;font-size:13px}
   .threadList{overflow:auto;flex:1}.threadCard{width:100%;border:0;border-top:1px solid #f3f4f6;background:#fff;padding:13px 14px;display:flex;gap:11px;text-align:left;cursor:pointer}.threadCard:hover,.threadCard.selected{background:#f9fafb}.threadCard.selected{box-shadow:inset 3px 0 #b91c3c}
   .profilePic{width:64px;height:64px;border-radius:50%;object-fit:cover}.threadAvatarPic{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:none}.avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#ec4899,#f59e0b);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:none}.avatar.large{width:42px;height:42px}.avatar.xlarge{width:64px;height:64px;font-size:16px}
   .threadCopy{min-width:0;flex:1}.threadTop{display:flex;justify-content:space-between;gap:8px;align-items:center}.threadTop strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.threadTop time{font-size:10px;color:#9ca3af}.threadCopy p{margin:4px 0 2px;color:#6b7280;font-size:12px}.threadCopy small{color:#9ca3af;font-size:10px}.emptyList{padding:28px 18px;color:#9ca3af;font-size:13px;text-align:center}
   .chatPane{min-width:0;background:#f7f8fa;display:flex;flex-direction:column}.chatHeader{background:#fff}.backButton{display:none;border:0;background:transparent;font-size:28px;line-height:1;color:#b91c3c;padding:0 4px;cursor:pointer}.contactTitle{display:flex;align-items:center;gap:10px}.contactTitle strong{font-size:14px}.senderBadge{font-size:11px;font-weight:800;border-radius:999px;padding:6px 9px}.senderBadge.on{background:#dcfce7;color:#166534}.senderBadge.off{background:#f3f4f6;color:#6b7280}
   .messages{flex:1;overflow:auto;padding:24px 28px;display:flex;flex-direction:column;gap:14px}.messageRow{display:flex;flex-direction:column;max-width:72%}.messageRow.incoming{align-self:flex-start;align-items:flex-start}.messageRow.outgoing{align-self:flex-end;align-items:flex-end}
   .bubble{border-radius:18px;padding:10px 13px;box-shadow:0 1px 2px rgba(0,0,0,.06);max-width:100%;overflow:hidden}.incoming .bubble{background:#fff;border-bottom-left-radius:5px}.outgoing .bubble{background:#fce8ed;border-bottom-right-radius:5px}.bubble p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.45}.bubbleMeta{margin-top:5px;color:#9ca3af;font-size:9px;text-align:right}.replyChip{margin-top:5px;border:0;background:transparent;color:#b91c3c;font-size:11px;font-weight:700;cursor:pointer;padding:3px 5px}
   .inboxMedia{max-width:100%;max-height:340px;border-radius:12px;display:block;margin-bottom:7px}.mediaPlaceholder{background:#f3f4f6;color:#9ca3af;padding:20px;border-radius:10px;font-size:12px}
   .composer{background:#fff;border-top:1px solid #e5e7eb;padding:12px 18px}.replyContext{display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border-left:3px solid #b91c3c;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#6b7280}.replyContext button{border:0;background:transparent;font-size:18px;color:#6b7280;cursor:pointer}
   .composerRow{display:flex;gap:10px;align-items:flex-end}.composer textarea{flex:1;resize:none;min-height:58px;max-height:130px;border:1px solid #d1d5db;border-radius:14px;padding:11px 12px;font:inherit;outline:0}.composer textarea:focus{border-color:#b91c3c}.sendButton{height:42px;border:0;border-radius:10px;padding:0 18px;background:#b91c3c;color:#fff;font-weight:800;cursor:pointer}.sendButton:disabled{background:#e5e7eb;color:#9ca3af;cursor:not-allowed}.composerFoot{display:flex;justify-content:space-between;color:#9ca3af;font-size:10px;margin-top:6px}
   .detailsHeader h3{margin:0;font-size:15px}.detailsBody{padding:20px}.profileCard{text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;padding-bottom:20px;border-bottom:1px solid #e5e7eb}.profileCard strong{margin-top:5px}.profileCard span{font-size:11px;color:#9ca3af}.detailBlock{padding:15px 0;border-bottom:1px solid #f3f4f6}.detailBlock label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;font-weight:800}.detailBlock p{font-size:12px;line-height:1.45;margin:5px 0 0}.detailBlock small{display:block;color:#9ca3af;font-size:10px;margin-top:6px}.aliasEditor{display:flex;gap:6px;margin-top:7px}.aliasEditor input{min-width:0;flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:12px}.aliasEditor button{border:0;border-radius:8px;background:#b91c3c;color:#fff;padding:0 10px;font-size:11px;font-weight:800}.muted{color:#9ca3af}.emptyChat{margin:auto;text-align:center;color:#6b7280}.emptyIcon{font-size:38px}.emptyChat h3{margin:10px 0 4px}.emptyChat p{margin:0;font-size:13px}.globalError{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fff;padding:10px 15px;border-radius:10px;font-size:12px}
   @media(max-width:1100px){.inboxShell{grid-template-columns:300px 1fr}.detailsPane{display:none}}
   @media(max-width:760px){.inboxShell{height:calc(100vh - 56px);grid-template-columns:1fr}.conversationPane{display:${selected?'none':'flex'}}.chatPane{display:${selected?'flex':'none'}}.detailsPane{display:none}.messageRow{max-width:88%}.messages{padding:16px}.backButton{display:block}.chatHeader{justify-content:flex-start;gap:6px}.senderBadge{margin-left:auto}}
  `}</style>
 </section>;
}
