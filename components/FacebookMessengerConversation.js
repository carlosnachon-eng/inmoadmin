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
 return <section aria-label="Conversación Facebook Messenger"><h2>Facebook Messenger</h2>
  <p>Sender {enabled?'habilitado':'OFF'} · Atención manual · Sin IA</p>
  <button type="button" onClick={refresh}>Actualizar historial</button>
  <div className="history">{rows.map(r=><article key={r.input} className={r.kind==='echo'?'outgoing':''}>
   <small>{r.kind==='echo'?'Respuesta · Facebook':'Cliente · Facebook'} · {new Date(r.occurred_at).toLocaleString('es-MX')}</small>
   <p>{r.text||(r.unsupported?'Adjunto recibido; visualización aún no soportada.':'Evento recibido')}</p>
   {r.outcome&&<small>Journal: {r.outcome}</small>}
   {r.can_reply&&<button type="button" disabled={busy||locked.current} aria-pressed={input===r.input} onClick={()=>setInput(r.input)}>Responder a este mensaje</button>}
  </article>)}</div>
  <form onSubmit={send}><label>Respuesta manual Facebook<textarea value={text} onChange={e=>setText(e.target.value)} maxLength={1000} disabled={!enabled||busy||locked.current}/></label>
   <button type="submit" disabled={!enabled||busy||locked.current||!input||!text.trim()}>Enviar una vez</button></form>
  <p role="status">{status}</p>
  <style jsx>{`.history{max-height:55vh;overflow:auto}article{padding:12px;margin:10px 0;background:#f1f5f9;border-radius:12px;overflow-wrap:anywhere}.outgoing{background:#e0e7ff}p{white-space:pre-wrap}textarea{display:block;width:100%;min-height:100px;box-sizing:border-box}button{min-height:44px;margin:5px 0}form{margin-top:16px}`}</style>
 </section>;
}
