import {useEffect,useRef,useState} from 'react';
import {inboxRequest} from './CommercialInbox';

export default function FacebookMessengerConversation({thread}){
 const [rows,setRows]=useState([]),[enabled,setEnabled]=useState(false),[text,setText]=useState(''),[input,setInput]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const locked=useRef(false),mounted=useRef(true);
 async function refresh(){
  try{const r=await inboxRequest('facebook','history',{thread});if(!mounted.current)return;
   setRows(r.rows);setEnabled(r.sender_enabled===true);
  }catch{if(mounted.current){setRows([]);setInput('');setEnabled(false);setStatus('Historial no disponible o acceso no autorizado.');}}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[thread]);
 async function send(e){
  e.preventDefault();if(locked.current||!enabled||!text.trim()||!rows.some(r=>r.input===input&&r.can_reply))return;
  locked.current=true;setBusy(true);setStatus('Envío manual en curso…');
  try{
   const result=await inboxRequest('facebook','reply',{body:{action:crypto.randomUUID(),input,text:text.trim()}});
   if(mounted.current)setStatus(result.status==='accepted'?'Aceptado por Meta. La recepción se confirma por echo.':`Resultado: ${result.status}. No se reintentará.`);
  }catch{if(mounted.current)setStatus('Resultado incierto. No reintentar; revisar journal.');}
  finally{if(mounted.current){setBusy(false);setText('');await refresh();}}
  // Remains locked after every attempt; refresh never dispatches or unlocks.
 }
 return <section className="fbConversation" aria-label="Conversación Facebook Messenger">
  <header className="fbHeader"><div><strong>Facebook Messenger</strong><span>{enabled?'Atención manual habilitada':'Sólo lectura · Envío desactivado'} · Sin IA</span></div><button type="button" onClick={refresh}>↻ Actualizar</button></header>
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
  {enabled?<form onSubmit={send} className="composer"><label htmlFor="facebook-reply-text">Respuesta manual</label><div className="composeRow"><textarea id="facebook-reply-text" value={text} onChange={e=>setText(e.target.value)} maxLength={1000} disabled={busy||locked.current} placeholder="Escribe una respuesta…"/><button type="submit" disabled={busy||locked.current||!input||!text.trim()} aria-label="Enviar una vez">➤</button></div></form>:<div className="readOnly">Las conversaciones recuperadas se pueden consultar. Los envíos siguen desactivados hasta terminar las pruebas de permisos.</div>}
  {status&&<p role="status" className="status">{status}</p>}
  <style jsx>{`
   .fbConversation{height:100%;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden;background:#f8fafc}
   .fbHeader{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;background:#fff;border-bottom:1px solid #e5e7eb}.fbHeader div{display:flex;flex-direction:column;gap:4px}.fbHeader strong{font-size:14px;color:#263348}.fbHeader span{font-size:11px;color:#64748b}.fbHeader button{background:white;border:1px solid #e5e7eb;border-radius:9px;padding:8px 11px;color:#475569;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap}
   .history{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;padding:18px;align-content:start}
   .messageRow{display:flex;width:100%}.messageRow.theirs{justify-content:flex-start}.messageRow.mine{justify-content:flex-end}
   .bubble{width:fit-content;max-width:min(78%,540px);border:1px solid #e2e8f0;background:#fff;border-radius:15px 15px 15px 4px;padding:11px 13px;box-sizing:border-box;overflow-wrap:anywhere}.outgoing{background:#e3efff;border-color:#cfe0fd;border-radius:15px 15px 4px 15px}
   .bubble p{white-space:pre-wrap;font-size:13px;line-height:1.5;margin:0;color:#263348}.bubble footer{display:block;text-align:right;margin-top:6px;color:#94a3b8;font-size:10px}.emptyHistory{color:#64748b;font-size:12px;text-align:center;margin:auto}
   .pickReply{margin-top:9px;background:transparent;border:0;color:#a51d40;font-size:11px;font-weight:700;cursor:pointer}
   .composer{flex-shrink:0;background:#fff;padding:12px 16px;border-top:1px solid #e5e7eb}.composer label{display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:7px}.composeRow{display:flex;align-items:flex-end;gap:9px}.composer textarea{flex:1;min-width:0;resize:vertical;min-height:48px;max-height:116px;padding:12px;border:1px solid #dbe1ea;border-radius:12px;font:inherit;font-size:13px}.composer button{width:38px;height:38px;border-radius:50%;background:#ae2148;color:#fff;border:0;font-size:15px;cursor:pointer}.composer button:disabled{background:#cbd5e1;cursor:not-allowed}
   .readOnly{flex-shrink:0;padding:12px 18px;background:#fff;border-top:1px solid #e5e7eb;font-size:11px;color:#64748b;line-height:1.5}
   .status{margin:0;padding:9px 18px;background:#fff7ed;color:#9a3412;font-size:11px}
   @media(max-width:760px){.fbHeader{padding:10px 12px}.history{padding:12px}.bubble{max-width:87%}}
  `}</style>
 </section>;
}
