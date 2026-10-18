import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {submitBusinessReply} from '../lib/messaging/instagram/business/replyResult';
async function request(op,{query={},body,binary=false}={}){
 const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('Sesión requerida');
 const r=await fetch('/api/operaciones/instagram-business?'+new URLSearchParams({op,...query}),{
  method:body?'POST':'GET',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error('Instagram no disponible; no se reintentará el envío');return binary?r.blob():r.json();
}
function Media({thread,input,index}){
 const [url,setUrl]=useState(null);
 useEffect(()=>{let active=true,object;request('media',{query:{thread,input,index:String(index)},binary:true}).then(blob=>{object=URL.createObjectURL(blob);if(active)setUrl(object);else URL.revokeObjectURL(object);}).catch(()=>{});
  return()=>{active=false;if(object)URL.revokeObjectURL(object);};},[thread,input,index]);
 return url?<img src={url} alt="Imagen recibida en Instagram" style={{maxWidth:280,maxHeight:300}}/>:<p>Imagen no disponible</p>;
}
export default function InstagramBusinessInbox(){
 const [threads,setThreads]=useState([]),[selected,setSelected]=useState(null),[rows,setRows]=useState([]),[text,setText]=useState(''),[input,setInput]=useState(null),[enabled,setEnabled]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),consumed=useRef(new Set()),generation=useRef(0);
 async function load(thread){if(lock.current)return;const gen=++generation.current;setBusy(true);try{
  const r=await request(thread?'history':'threads',{query:thread?{thread}:{}});if(gen!==generation.current)return;
  setEnabled(r.sender_enabled);if(thread){setRows(r.rows);setSelected(thread);setInput(null);setText('');}else setThreads(r.rows);
 }catch(e){setStatus(e.message);}finally{if(gen===generation.current)setBusy(false);}}
 async function send(e){e.preventDefault();if(lock.current||!enabled||!input||consumed.current.has(input))return;
  lock.current=true;consumed.current.add(input);setBusy(true);setStatus('pending');
  try{const r=await submitBusinessReply({request,thread:selected,input,action:crypto.randomUUID(),text:text.trim()});setStatus(r.status+(r.status==='uncertain'?' · no reenviar':r.source==='journal'?' · journal confirmado':'')+(r.diagnostic?.stage==='pre_claim'&&/^[a-z_]{1,64}$/.test(r.diagnostic.validation)?` · pre_claim / ${r.diagnostic.validation}`:''));}
  catch{setStatus('uncertain · no reenviar');}finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label="Instagram Business Inbox"><h2>Instagram · Emporio</h2>
  <p>Meta directo · atención manual · Respond permanece conectado. Histórico legacy separado.</p>
  <button disabled={busy} onClick={()=>load()}>Actualizar conversaciones Instagram</button>
  <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:20}}>
   <nav aria-label="Conversaciones Instagram">{threads.map((t,i)=><button key={t.thread_ref} disabled={busy} onClick={()=>load(t.thread_ref)} style={{display:'block',margin:8}}>Contacto sin identificar {i+1}<br/>{new Date(t.last_activity).toLocaleString('es-MX')}</button>)}</nav>
   <section aria-label="Historial Instagram">{rows.map(r=><article key={r.input} style={{textAlign:r.direction==='customer_inbound'?'left':'right',padding:12,background:'#f1f5f9',margin:8}}>
    <small>{new Date(r.occurred_at).toLocaleString('es-MX')} · {r.direction==='customer_inbound'?'Mensaje recibido':'Mensaje saliente'}</small>
    <p style={{whiteSpace:'pre-wrap'}}>{r.text}</p>
    {r.attachments.map(a=>a.type==='image'?<Media key={a.index} thread={selected} input={r.input} index={a.index}/>:<p key={a.index}>Adjunto no disponible</p>)}
    {r.paused&&<p>IA pausada por atención humana</p>}{r.status&&<p>{r.status}</p>}
    {r.direction==='customer_inbound'&&!r.deleted&&!r.status&&<button disabled={busy||consumed.current.has(r.input)} onClick={()=>setInput(r.input)}>Responder a este mensaje</button>}
   </article>)}</section>
  </div>
  <form onSubmit={send}><label htmlFor="business-reply">Respuesta manual Instagram</label><textarea id="business-reply" value={text} onChange={e=>setText(e.target.value)} maxLength={999} disabled={busy||!enabled||!input||consumed.current.has(input)}/>
   <button disabled={busy||!enabled||!input||!text.trim()||consumed.current.has(input)}>Enviar respuesta manual</button></form>
  {!enabled&&<p>Sender OFF</p>}<p role="status">{status}</p><p>Accepted no acredita entrega ni lectura. Sin reintentos automáticos.</p>
 </section>;
}
