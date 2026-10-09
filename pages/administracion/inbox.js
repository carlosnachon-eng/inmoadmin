import {useRef,useState} from 'react';
import Head from 'next/head';
import Layout from '../../components/Layout';
import {supabase} from '../../lib/supabase';

const provenance={customer_inbound:'Entrada del contacto',business_outbound_unattributed:'Salida observada · autor no acreditado',human_confirmed:'Humano confirmado',system_outbound_confirmed:'Sistema confirmado'};
const attachment={not_available:'Adjunto no disponible',interpretation_pending:'Referencia recibida · interpretación pendiente'};
const time=value=>new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'}).format(new Date(value));

export default function AdminInbox(){
 const [rows,setRows]=useState([]),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 const [manual,setManual]=useState(null),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendStatus,setSendStatus]=useState('');
 const sendLock=useRef(false),action=useRef(null);
 async function manualRequest(inputId,body){
  const {data}=await supabase.auth.getSession();
  if(!data?.session?.access_token)throw Error('Sesión requerida.');
  const response=await fetch('/api/operaciones/meta-admin-inbox-manual'+(body?'':'?input_id='+encodeURIComponent(inputId)),{
   method:body?'POST':'GET',redirect:'error',cache:'no-store',headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('Estado manual no disponible. No se reintentará el envío.');
  return response.json();
 }
 async function send(){
  if(sendLock.current||!detail||action.current)return;
  sendLock.current=true;setSending(true);setSendStatus('Procesando');
  const id=generation.current,inputId=detail.input_id;
  action.current=crypto.randomUUID(); // retained after ANY outcome; never automatic retry
  try{
   const r=await manualRequest(inputId,{input_id:inputId,action_id:action.current,text:draft.trim()});
   if(id===generation.current){setSendStatus(r.status);if(r.paused)setManual(x=>({...x,data:{...x?.data,paused:true}}));}
   const m=await manualRequest(inputId);if(id===generation.current)setManual(m);
  }catch{if(id===generation.current)setSendStatus('uncertain · consulta el estado; no reintentar');}
  finally{sendLock.current=false;setSending(false);}
 }
 async function read(query=''){
  const {data,error:sessionError}=await supabase.auth.getSession();
  if(sessionError||!data?.session?.access_token)throw Error('Sesión requerida.');
  const r=await fetch('/api/operaciones/meta-admin-inbox'+query,{headers:{Authorization:`Bearer ${data.session.access_token}`},cache:'no-store',redirect:'error'});
  if(!r.ok)throw Error(r.status===403?'Sin permiso para esta Inbox.':'Inbox no disponible. Las RPCs locales requieren revisión e instalación.');
  return (await r.json()).data;
 }
 async function load(inputId){
  if(sendLock.current)return;
  const id=++generation.current;setBusy(true);setError('');setDetail(null);setManual(null);setDraft('');setSendStatus('');action.current=null;
  try{const result=await read(inputId?'?input_id='+encodeURIComponent(inputId):'');
   if(id!==generation.current)return;
   if(inputId){setDetail(result);try{const m=await manualRequest(inputId);if(id===generation.current)setManual(m);}catch{if(id===generation.current)setError('Envío manual bloqueado: estado no disponible.');}}else setRows(result);
  }catch(e){if(id===generation.current)setError(e.message);}
  finally{if(id===generation.current)setBusy(false);}
 }
 return <Layout><Head><title>Administración · Inbox Meta</title></Head><main style={{padding:24}}>
  <h1>Inbox de Administración</h1>
  <p>Meta directo · respuestas manuales autorizadas · sin respuesta automática.</p>
  <button onClick={()=>load()} disabled={busy||sending}>Cargar / actualizar conversaciones</button>
  {error&&<p role="alert">{error}</p>}
  <div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(300px,2fr)',gap:24,marginTop:20}}>
   <nav aria-label="Conversaciones"><ul style={{listStyle:'none',padding:0}}>{rows.map(r=><li key={r.input_id} style={{marginBottom:12}}>
    <button disabled={busy||sending} onClick={()=>load(r.input_id)} style={{textAlign:'left',width:'100%',padding:12}}>
     {r.label} · {r.input_id.slice(0,8)}<br/><small>{r.identity_state} · {time(r.last_activity)}</small>
    </button>
   </li>)}</ul>{!rows.length&&<p>Carga la lista para consultar los registros disponibles.</p>}</nav>
   <section aria-label="Detalle de conversación" aria-busy={busy}>
    {detail?<>
     <h2>{detail.identity_state==='matched'?'Identidad acreditada':'Sin identidad canónica acreditada'}</h2>
     {manual?.data?.paused&&<p role="status" style={{padding:12,background:'#fff3cd'}}>IA pausada por atención humana · sin reanudación disponible.</p>}
     <p>IA: {detail.ai.state==='shadow_available'?'Shadow disponible sólo por operador; no envío automático':'Bloqueada / requiere revisión'}.</p>
     <h3>Contexto autorizado</h3>
     {detail.context.state==='ready'?<dl>
      <dt>Rol</dt><dd>{detail.context.roles.join(', ')}</dd>
      <dt>Propiedad/unidad</dt><dd>{detail.context.property_ref||detail.context.unit_ref||'Sin dato acreditado'}</dd>
      <dt>Contrato</dt><dd>{detail.context.contract_ref||'Sin contrato único acreditado'}</dd>
      {detail.context.agreement&&<><dt>Vigencia</dt><dd>{detail.context.agreement.start_date} — {detail.context.agreement.end_date}</dd></>}
     </dl>:<p>{detail.context.state==='ambiguous'?'Contexto ambiguo: requiere aclaración.':'Sin contexto privado autorizado.'}</p>}
     <h3>Asuntos acreditados</h3>
     {detail.episodes.length?<ul>{detail.episodes.map(e=><li key={e.id}>{e.topic} · {e.status} · pendiente: {e.pending}{e.contradiction?' · contradicción: revisión requerida':''}</li>)}</ul>:<p>Sin memoria de asunto compatible con el alcance actual.</p>}
     <h3>Historial</h3>
     {detail.history_truncated&&<p>Se muestran sólo los últimos 100 registros; historial incompleto.</p>}
     <ol>{detail.messages.map(m=><li key={m.message_ref} style={{marginBottom:16}}>
      <small>{time(m.occurred_at)} · {provenance[m.provenance]}</small>
      <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.modified?'Mensaje modificado/revocado: contenido no mostrado.':m.text||attachment[m.attachment]||'Contenido no disponible en el journal.'}</p>
     </li>)}</ol>
     <label htmlFor="manual-reply">Respuesta manual por Meta</label><br/>
     <textarea id="manual-reply" disabled={!manual?.enabled||sending||!!action.current} maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)} rows={4} style={{width:'100%'}} placeholder="Respuesta manual (máximo 2,000 caracteres)."/>
     <button disabled={!manual?.enabled||busy||sending||!draft.trim()||!!action.current} onClick={send}>{sending?'Enviando…':'Enviar por Meta'}</button>
     {!manual?.enabled&&<p>Envío manual OFF / no disponible.</p>}
     <p role="status">{sendStatus}</p>
     {sendStatus==='accepted'&&<button onClick={()=>{action.current=null;setDraft('');setSendStatus('');}}>Redactar otro mensaje (acción nueva)</button>}
     <p>Un intento por acción. Ante incertidumbre, consulta el estado y no repitas el mensaje.</p>
     <h3>Mensajes manuales de Inmoadmin</h3>
     <button disabled={busy||sending} onClick={async()=>{const id=generation.current;try{const m=await manualRequest(detail.input_id);if(id===generation.current)setManual(m);}catch{setError('No fue posible consultar el estado.');}}}>Consultar estado (sin reenviar)</button>
     <ul>{manual?.data?.messages?.map(m=><li key={m.action_id}><small>{time(m.created_at)} · humano autenticado · {m.status}</small><p style={{whiteSpace:'pre-wrap'}}>{m.text}</p>{m.contradictory&&<p>Estados contradictorios: revisión requerida.</p>}</li>)}</ul>
    </>:<p>Selecciona una conversación. No se ejecutan modelos al abrir esta página.</p>}
   </section>
  </div>
 </main></Layout>;
}
