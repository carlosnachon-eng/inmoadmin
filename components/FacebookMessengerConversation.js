import {useEffect,useRef,useState} from 'react';
import {inboxRequest} from './CommercialInbox';
import {supabase} from '../lib/supabase';

export default function FacebookMessengerConversation({thread,displayName='',onNameSaved}){
 const [rows,setRows]=useState([]),[enabled,setEnabled]=useState(false),[text,setText]=useState(''),[input,setInput]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const locked=useRef(false),mounted=useRef(true);
 const [detailsOpen,setDetailsOpen]=useState(false),[phone,setPhone]=useState(''),[email,setEmail]=useState(''),[contactBusy,setContactBusy]=useState(false),[contactStatus,setContactStatus]=useState('');
 useEffect(()=>{let live=true;setPhone('');setEmail('');setContactStatus('');
  supabase.auth.getSession().then(async({data})=>{
   if(!data?.session)return;
   const response=await fetch('/api/operaciones/facebook-messenger-contact?'+new URLSearchParams({thread}),{cache:'no-store',headers:{Authorization:'Bearer '+data.session.access_token}});
   if(!response.ok)throw Error('unavailable');
   const result=await response.json();
   if(live){setPhone(result.phone||'');setEmail(result.email||'');}
  }).catch(()=>{if(live)setContactStatus('No se pudieron cargar los datos de contacto.');});
  return()=>{live=false};
 },[thread]);
 async function saveContact(){
  if(contactBusy)return;setContactBusy(true);setContactStatus('');
  try{
   const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('auth');
   const response=await fetch('/api/operaciones/facebook-messenger-contact',{method:'POST',cache:'no-store',redirect:'error',
    headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({thread,phone:phone.trim(),email:email.trim()})});
   if(!response.ok)throw Error('unavailable');setContactStatus('Contacto guardado.');
  }catch{setContactStatus('No se pudieron guardar los datos.');}
  finally{setContactBusy(false);}
 }

 const [canAssign,setCanAssign]=useState(false),[advisors,setAdvisors]=useState([]),[assigned,setAssigned]=useState(null),[advisorDraft,setAdvisorDraft]=useState(''),[assignBusy,setAssignBusy]=useState(false),[assignStatus,setAssignStatus]=useState('');
 useEffect(()=>{let live=true;setAssigned(null);setAdvisorDraft('');setAssignStatus('');
  (async()=>{
   const {data}=await supabase.auth.getSession();if(!data?.session)return;
   const headers={Authorization:'Bearer '+data.session.access_token};
   const options=await fetch('/api/operaciones/facebook-messenger-advisors',{cache:'no-store',headers});
   if(!options.ok)return;
   const details=await fetch('/api/operaciones/facebook-messenger-assign?'+new URLSearchParams({thread}),{cache:'no-store',headers});
   if(!details.ok)return;
   const [opts,current]=await Promise.all([options.json(),details.json()]);
   if(live){setCanAssign(true);setAdvisors(opts.advisors||[]);setAssigned(current.assignment||null);setAdvisorDraft(current.assignment?.advisor_id||'');}
  })().catch(()=>{});return()=>{live=false};
 },[thread]);
 async function saveAssignment(){
  if(assignBusy||!advisorDraft)return;setAssignBusy(true);setAssignStatus('');
  try{const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('auth');
   const response=await fetch('/api/operaciones/facebook-messenger-assign',{method:'POST',cache:'no-store',redirect:'error',
    headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({thread,advisor:advisorDraft})});
   if(!response.ok)throw Error('assign');
   const current=advisors.find(a=>a.id===advisorDraft);
   setAssigned({advisor_id:advisorDraft,advisor_name:current?.name||'Asesor'});
   setAssignStatus('Asignación guardada.');
  }catch{setAssignStatus('No fue posible asignar el chat; revisa permisos o el mensaje entrante.');}
  finally{setAssignBusy(false);}
 }
 const [canRename,setCanRename]=useState(false),[nameDraft,setNameDraft]=useState(displayName),[nameStatus,setNameStatus]=useState('');
 useEffect(()=>{setNameDraft(displayName||'')},[displayName,thread]);
 useEffect(()=>{let live=true;supabase.auth.getUser().then(async({data})=>{if(!data?.user)return;const {data:profile}=await supabase.from('profiles').select('active,role_id').eq('id',data.user.id).maybeSingle();if(live)setCanRename(profile?.active===true&&profile?.role_id==='admin');}).catch(()=>{});return()=>{live=false};},[]);
 async function saveName(){
  const alias=nameDraft.trim();if(alias.length<2||alias.length>90)return;
  setNameStatus('Guardando…');
  try{const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('auth');
   const r=await fetch('/api/operaciones/facebook-messenger-names',{method:'POST',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({thread,alias})});
   if(!r.ok)throw Error('save');setNameStatus('Nombre guardado');if(onNameSaved)await onNameSaved();
  }catch{setNameStatus('No se pudo guardar el nombre.');}
 }

 async function refresh(){
  try{const r=await inboxRequest('facebook','history',{thread});if(!mounted.current)return;
   const items=Array.isArray(r.rows)?r.rows:[];
   setRows(items);setEnabled(r.sender_enabled===true);
   if(!locked.current){const latest=[...items].reverse().find(item=>item.can_reply===true&&item.kind==='inbound');
    setInput(previous=>items.some(item=>item.input===previous&&item.can_reply===true)?previous:(latest?.input||''));}
  }catch{if(mounted.current){setRows([]);setInput('');setEnabled(false);setStatus('Historial no disponible o acceso no autorizado.');}}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[thread]);
 async function send(e){
  e.preventDefault();if(locked.current||!enabled||!text.trim()||!rows.some(r=>r.input===input&&r.can_reply))return;
  locked.current=true;setBusy(true);setStatus('Envío manual en curso…');
  try{
   const result=await inboxRequest('facebook','reply',{body:{action:crypto.randomUUID(),input,text:text.trim()}});
   if(mounted.current)setStatus(result.status==='accepted'?'Aceptado por Meta. Puedes enviar otro mensaje mientras la ventana esté abierta.':`Resultado: ${result.status}. No reintentes un envío incierto.`);
   if(result.status==='accepted')locked.current=false;
  }catch{if(mounted.current)setStatus('Resultado incierto. No reintentar; revisar journal.');}
  finally{if(mounted.current){setBusy(false);setText('');await refresh();}}
  // Remains locked after every attempt; refresh never dispatches or unlocks.
 }
 return <section className="fbConversation" aria-label="Conversación Facebook Messenger">
  <div className="fbWorkspace"><div className="fbChat"><header className="fbHeader"><div><strong>{displayName||'Contacto de Facebook'}</strong><span>Facebook Messenger · </span><span>{enabled?'Atención manual habilitada':'Sólo lectura · Envío desactivado'} · Sin IA</span></div><div className="fbActions"><button type="button" className="mobileDetails" onClick={()=>setDetailsOpen(v=>!v)}>Ficha</button><button type="button" onClick={refresh}>↻ Actualizar</button></div></header>
  {nameStatus&&<p role="status" className="nameStatus">{nameStatus}</p>}
  <div className="history" role="log" aria-label="Mensajes de Facebook">
   {!rows.length&&<p className="emptyHistory">No hay mensajes disponibles para esta conversación.</p>}
   {rows.map(r=><div key={r.input} className={r.kind==='echo'?'messageRow mine':'messageRow theirs'}>
    <article className={r.kind==='echo'?'bubble outgoing':'bubble'}>
     <p>{r.text||(r.unsupported?'Adjunto recibido · vista previa no disponible':'Evento recibido')}</p>
     <footer><time>{new Date(r.occurred_at).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time>{r.outcome&&<span> · {r.outcome}</span>}</footer>
     {enabled&&r.can_reply&&<button type="button" className="pickReply" disabled={busy||locked.current} aria-pressed={input===r.input} onClick={()=>setInput(r.input)}>{input===r.input?'Seleccionado':'Responder a este mensaje'}</button>}
    </article>
   </div>)}
  </div>
  {enabled?<form onSubmit={send} className="composer"><label htmlFor="facebook-reply-text">Respuesta manual</label><small className="replyHint">{input?'Ventana activa · cada mensaje se registra y envía una sola vez':'No hay mensaje entrante elegible para responder en esta conversación'}</small><div className="composeRow"><textarea id="facebook-reply-text" value={text} onChange={e=>setText(e.target.value)} maxLength={1000} disabled={busy||locked.current} placeholder="Escribe una respuesta…"/><button type="submit" disabled={busy||locked.current||!rows.some(r=>r.input===input&&r.can_reply)||!text.trim()} aria-label="Enviar una vez">➤</button></div></form>:<div className="readOnly">Las conversaciones recuperadas se pueden consultar. Los envíos siguen desactivados hasta terminar las pruebas de permisos.</div>}
  {status&&<p role="status" className="status">{status}</p>}</div>
  <aside className={'fbDetails '+(detailsOpen?'open':'')} aria-label="Detalles del contacto Facebook">
   <div className="detailsHeading"><strong>Detalles</strong><button type="button" onClick={()=>setDetailsOpen(false)} aria-label="Cerrar ficha">×</button></div>
   <div className="detailsScroll">
    <div className="profileCard"><div className="fbAvatar">f</div><strong>{displayName||'Contacto de Facebook'}</strong><small>Facebook Messenger · Meta directo</small></div>
    <section className="detailBlock"><label>Nombre interno</label>
     <div className="editFields"><input value={nameDraft} onChange={e=>setNameDraft(e.target.value)} maxLength={90} placeholder={displayName||'Ej. Cliente casa Angelópolis'} disabled={!canRename}/>{canRename&&<button type="button" disabled={nameDraft.trim().length<2} onClick={saveName}>Guardar</button>}</div>
     {nameStatus&&<small role="status">{nameStatus}</small>}<small>El nombre interno no modifica el perfil de Facebook.</small>
    </section>
    <section className="detailBlock"><label>Contacto</label><div className="editFields">
     <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Teléfono" maxLength={32} disabled={!canRename}/>
     <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Correo electrónico" maxLength={254} disabled={!canRename}/>
     {canRename&&<button type="button" onClick={saveContact} disabled={contactBusy}>{contactBusy?'Guardando…':'Guardar contacto'}</button>}
    </div>{contactStatus&&<small role="status">{contactStatus}</small>}</section>
    <section className="detailBlock"><label>Asignado a</label>
     <p>{assigned?.advisor_name||'Sin asignar'}</p>
     {canAssign&&<div className="editFields"><select value={advisorDraft} onChange={e=>setAdvisorDraft(e.target.value)} aria-label="Asesor asignado Facebook">
       <option value="">Selecciona un asesor</option>{advisors.map(a=><option key={a.id} value={a.id}>{a.name}{a.plaza?' · '+a.plaza:''}</option>)}
      </select><button type="button" disabled={!advisorDraft||assignBusy} onClick={saveAssignment}>{assignBusy?'Guardando…':assigned?'Reasignar':'Asignar'}</button></div>}
     {assignStatus&&<small role="status">{assignStatus}</small>}
    </section>
    <section className="detailBlock"><label>Canal</label><p>Facebook Messenger</p></section>
    <section className="detailBlock"><label>Estado</label><p>{enabled?'Atención manual habilitada':'Lectura disponible · Sender OFF'}</p></section>
    <section className="detailBlock"><label>Seguridad</label><p>Contenido y datos de contacto cifrados. Sin IA ni reintentos automáticos.</p></section>
   </div>
  </aside></div>
  <style jsx>{`
   .fbConversation{height:100%;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden;background:#f8fafc}.fbWorkspace{display:grid;grid-template-columns:minmax(0,1fr) 265px;flex:1;min-height:0;overflow:hidden}.fbChat{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
   .fbHeader{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;background:#fff;border-bottom:1px solid #e5e7eb}.fbHeader div{display:flex;flex-direction:column;gap:4px}.fbHeader strong{font-size:14px;color:#263348}.fbHeader span{font-size:11px;color:#64748b}.fbHeader button{background:white;border:1px solid #e5e7eb;border-radius:9px;padding:8px 11px;color:#475569;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap}
   .fbDetails{min-width:0;min-height:0;display:flex;flex-direction:column;border-left:1px solid #e5e7eb;background:#fff}.detailsHeading{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e7eb}.detailsHeading strong{font-size:14px}.detailsHeading button{display:none}.detailsScroll{overflow-y:auto;min-height:0;flex:1;overscroll-behavior:contain}.profileCard{display:flex;flex-direction:column;align-items:center;text-align:center;gap:7px;padding:22px 12px;border-bottom:1px solid #edf0f4}.profileCard strong{font-size:13px;overflow-wrap:anywhere}.profileCard small{color:#94a3b8;font-size:11px}.fbAvatar{width:55px;height:55px;border-radius:50%;background:#1877f2;color:white;display:grid;place-items:center;font-size:34px;font-weight:700}.detailBlock{padding:15px;border-bottom:1px solid #edf0f4}.detailBlock label{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:9px}.detailBlock p{margin:0;font-size:12px;color:#475569;line-height:1.55}.detailBlock small{display:block;margin-top:6px;font-size:10px;color:#94a3b8}.editFields{display:flex;flex-direction:column;gap:7px}.editFields select{min-width:0;width:100%;box-sizing:border-box;border:1px solid #dbe1ea;border-radius:8px;padding:9px;font-size:12px}.editFields input{min-width:0;width:100%;box-sizing:border-box;border:1px solid #dbe1ea;border-radius:8px;padding:9px;font-size:12px}.editFields input:disabled{background:#f8fafc}.editFields button{background:#ae2148;color:white;border:0;border-radius:8px;padding:9px;font-weight:700;font-size:11px;cursor:pointer}.editFields button:disabled{opacity:.5}.mobileDetails{display:none}
   .fbActions{display:flex;gap:6px}.nameEditor{display:flex;gap:8px;background:#fff;padding:8px 14px;border-bottom:1px solid #e5e7eb}.nameEditor input{flex:1;min-width:0;border:1px solid #dbe1ea;border-radius:8px;padding:8px;font-size:12px}.nameEditor button{border:0;background:#a51d40;color:#fff;border-radius:8px;padding:8px 12px;font-size:11px;cursor:pointer}.nameEditor button:disabled{opacity:.5}.nameStatus{margin:0;padding:5px 14px;font-size:11px;color:#64748b;background:white}
   .history{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;padding:18px;align-content:start}
   .messageRow{display:flex;width:100%}.messageRow.theirs{justify-content:flex-start}.messageRow.mine{justify-content:flex-end}
   .bubble{width:fit-content;max-width:min(78%,540px);border:1px solid #e2e8f0;background:#fff;border-radius:15px 15px 15px 4px;padding:11px 13px;box-sizing:border-box;overflow-wrap:anywhere}.outgoing{background:#e3efff;border-color:#cfe0fd;border-radius:15px 15px 4px 15px}
   .bubble p{white-space:pre-wrap;font-size:13px;line-height:1.5;margin:0;color:#263348}.bubble footer{display:block;text-align:right;margin-top:6px;color:#94a3b8;font-size:10px}.emptyHistory{color:#64748b;font-size:12px;text-align:center;margin:auto}
   .pickReply{margin-top:9px;background:transparent;border:0;color:#a51d40;font-size:11px;font-weight:700;cursor:pointer}
   .replyHint{display:block;font-size:10px;color:#64748b;margin:-3px 0 8px}.composer{flex-shrink:0;background:#fff;padding:12px 16px;border-top:1px solid #e5e7eb}.composer label{display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:7px}.composeRow{display:flex;align-items:flex-end;gap:9px}.composer textarea{flex:1;min-width:0;resize:vertical;min-height:48px;max-height:116px;padding:12px;border:1px solid #dbe1ea;border-radius:12px;font:inherit;font-size:13px}.composer button{width:38px;height:38px;border-radius:50%;background:#ae2148;color:#fff;border:0;font-size:15px;cursor:pointer}.composer button:disabled{background:#cbd5e1;cursor:not-allowed}
   .readOnly{flex-shrink:0;padding:12px 18px;background:#fff;border-top:1px solid #e5e7eb;font-size:11px;color:#64748b;line-height:1.5}
   .status{margin:0;padding:9px 18px;background:#fff7ed;color:#9a3412;font-size:11px}
   @media(max-width:1000px){.fbWorkspace{grid-template-columns:minmax(0,1fr)}.fbDetails{display:none;position:absolute;right:0;top:0;bottom:0;width:min(330px,90%);z-index:5;box-shadow:-12px 0 28px #0f172a21}.fbDetails.open{display:flex}.fbConversation{position:relative}.mobileDetails{display:inline-block}.detailsHeading button{display:block;border:0;background:transparent;font-size:22px;cursor:pointer}}@media(max-width:760px){.fbHeader{padding:10px 12px}.history{padding:12px}.bubble{max-width:87%}}
  `}</style>
 </section>;
}
