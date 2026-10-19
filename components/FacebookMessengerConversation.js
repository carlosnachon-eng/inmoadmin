import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {inboxRequest} from './CommercialInbox';
import {supabase} from '../lib/supabase';
import FacebookReceivedMedia from './FacebookReceivedMedia';

function FacebookLinkifiedText({value}){
 const parts=String(value||'').split(/(https?:\/\/[^\s]+)/g);
 return <p>{parts.map((part,i)=>/^https?:\/\/[^\s]+$/i.test(part)
  ?<a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{color:'#1769bd',textDecoration:'underline',overflowWrap:'anywhere'}}>{part}</a>
  :part)}</p>;
}

export default function FacebookMessengerConversation({thread,displayName='',onNameSaved}){
 const [rows,setRows]=useState([]),[enabled,setEnabled]=useState(false),[text,setText]=useState(''),[input,setInput]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const locked=useRef(false),mounted=useRef(true);
 const [propertyPicker,setPropertyPicker]=useState(false),[propertyRows,setPropertyRows]=useState([]),[propertySearch,setPropertySearch]=useState(''),[propertyLoading,setPropertyLoading]=useState(false),[propertyChoices,setPropertyChoices]=useState([]);
 async function openProperties(){
  if(!enabled||busy||locked.current||!rows.some(r=>r.input===input&&r.can_reply))return;
  setPropertyLoading(true);setPropertyPicker(true);setPropertyChoices([]);
  try{
   const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('session');
   const response=await fetch('/api/operaciones/facebook-messenger-properties?'+new URLSearchParams({thread}),{
    headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store'});
   if(!response.ok)throw Error('properties');
   const result=await response.json();setPropertyRows(result.rows||[]);
  }catch{setStatus('No se pudieron cargar las propiedades');setPropertyPicker(false);}
  finally{setPropertyLoading(false);}
 }
 function toggleProperty(p){
  setPropertyChoices(current=>{
   if(current.some(x=>x.id===p.id))return current.filter(x=>x.id!==p.id);
   if(current.length>=5){setStatus('Puedes compartir hasta cinco propiedades por mensaje');return current;}
   return [...current,p];
  });
 }
 function prepareProperties(){
  if(!propertyChoices.length)return;
  const short=(v,n)=>String(v||'').length>n?String(v).slice(0,n-1).trimEnd()+'…':String(v||'');
  const parts=propertyChoices.map((p,i)=>{
   const url='https://www.emporioinmobiliario.com.mx/propiedades/'+encodeURIComponent(p.public_id);
   const price=Number(p.precio);
   const money=Number.isFinite(price)?new Intl.NumberFormat('es-MX',{style:'currency',currency:p.moneda==='USD'?'USD':'MXN',maximumFractionDigits:0}).format(price):'Precio a consultar';
   const operation=p.operacion==='sale'?'Venta':'Renta';
   const location=short([p.colonia,p.ciudad].filter(Boolean).join(', '),42);
   return (i+1)+'. '+short(p.titulo,58)+'\n'+money+' · '+operation+(location?' · '+location:'')+'\n'+url;
  });
  const message='Te comparto estas opciones:\n\n'+parts.join('\n\n');
  if(new TextEncoder().encode(message).length>980){setStatus('El mensaje es demasiado largo; selecciona menos propiedades');return;}
  setText(message);setPropertyPicker(false);setPropertyChoices([]);
 }
 const [pendingMedia,setPendingMedia]=useState(null),[recording,setRecording]=useState(false);
 const mediaInputRef=useRef(null),recorderRef=useRef(null),streamRef=useRef(null),chunksRef=useRef([]),cancelRecordingRef=useRef(false);
 const allowedMime=new Set(['image/jpeg','image/png','image/webp','video/mp4','audio/mp4']);
 function clearPending(){setPendingMedia(null);if(mediaInputRef.current)mediaInputRef.current.value='';}
 function selectMedia(file){
  if(!file)return;
  if(!allowedMime.has(file.type)||file.size<1||file.size>(file.type.startsWith('image/')?8388608:26214400)){
   setStatus('Archivo no compatible o demasiado grande');return;
  }
  setPendingMedia(file);setStatus('');
 }
 async function startRecording(){
  if(recording||pendingMedia||busy||locked.current||!enabled)return;
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setStatus('Este navegador no permite grabar audio');return;}
  let stream;
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const mime=['audio/mp4;codecs=mp4a.40.2','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
   if(!mime){stream.getTracks().forEach(t=>t.stop());setStatus('Grabación MP4 no disponible');return;}
   const recorder=new MediaRecorder(stream,{mimeType:mime});streamRef.current=stream;recorderRef.current=recorder;chunksRef.current=[];cancelRecordingRef.current=false;
   recorder.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data);};
   recorder.onstop=()=>{
    stream.getTracks().forEach(t=>t.stop());streamRef.current=null;setRecording(false);
    const chunks=chunksRef.current;chunksRef.current=[];
    if(chunks.length&&!cancelRecordingRef.current)setPendingMedia(new File(chunks,'nota-voz.m4a',{type:'audio/mp4'}));
   cancelRecordingRef.current=false;
   };
   recorder.start(250);setRecording(true);setStatus('Grabando…');
  }catch{stream?.getTracks().forEach(t=>t.stop());setStatus('No se pudo acceder al micrófono');}
 }
 function stopRecording(cancel=false){
  const r=recorderRef.current;
  if(cancel)cancelRecordingRef.current=true;
  if(r&&r.state==='recording'){if(cancel)r.ondataavailable=()=>{};r.stop();}
  streamRef.current?.getTracks().forEach(t=>t.stop());
  if(cancel){chunksRef.current=[];setPendingMedia(null);}
  setRecording(false);
 }
 useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop());},[]);
 async function sendMedia(){
  const file=pendingMedia;
  if(!file||locked.current||busy||!enabled||!rows.some(r=>r.input===input&&r.can_reply))return;
  const {data}=await supabase.auth.getSession();
  if(!data?.session?.user?.id){setStatus('Sesión requerida');return;}
  const ext=file.type==='audio/mp4'?'m4a':file.type==='video/mp4'?'mp4':file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  const path=data.session.user.id+'/'+crypto.randomUUID()+'.'+ext;
  locked.current=true;setBusy(true);setStatus('Subiendo archivo…');
  try{
   const uploaded=await supabase.storage.from('facebook-messenger-outbound').upload(path,file,{contentType:file.type,upsert:false});
   if(uploaded.error)throw Error('upload');
   const action=crypto.randomUUID();
   const result=await inboxRequest('facebook','media-reply',{body:{action,input,mime:file.type,path,size:file.size}});
   if(result.status==='accepted'){setStatus('Meta aceptó el archivo. Esperando confirmación.');clearPending();locked.current=false;}
   else if(result.status==='failed'){setStatus('Meta rechazó el archivo; no se reenviará automáticamente.');locked.current=false;}
   else setStatus('Resultado incierto. No reenvíes el archivo hasta revisar el registro.');
  }catch{setStatus('Resultado no confirmado. No vuelvas a enviar sin revisar.');}
  finally{setBusy(false);await refresh();}
 }
 const [appointmentOpen,setAppointmentOpen]=useState(false),[appointmentBusy,setAppointmentBusy]=useState(false),[appointmentRows,setAppointmentRows]=useState([]),[appointmentAdvisors,setAppointmentAdvisors]=useState([]),[appointmentProperties,setAppointmentProperties]=useState([]);
 const [appointmentForm,setAppointmentForm]=useState({name:'',phone:'',email:'',advisor_id:'',property_id:'',fecha_local:'',notas:''});
 async function appointmentRequest(op,body){
  const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('session');
  const response=await fetch('/api/operaciones/facebook-messenger-appointments?'+new URLSearchParams({op,thread}),{
   method:body?'POST':'GET',cache:'no-store',redirect:'error',
   headers:{Authorization:'Bearer '+data.session.access_token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify({...body,thread})}:{})});
  if(!response.ok)throw Error('appointment');
  return response.json();
 }
 async function loadAppointments(){
  try{const result=await appointmentRequest('list');setAppointmentRows(result.rows||[]);}catch{}
 }
 useEffect(()=>{setAppointmentRows([]);void loadAppointments();},[thread]);
 async function openAppointment(){
  if(busy||appointmentBusy)return;
  setAppointmentBusy(true);
  try{
   const result=await appointmentRequest('options');
   setAppointmentAdvisors(result.advisors||[]);setAppointmentProperties(result.properties||[]);
   const {data}=await supabase.auth.getSession();
   setAppointmentForm({name:displayName||'',phone:phone||'',email:email||'',advisor_id:assigned?.advisor_id||data?.session?.user?.id||'',property_id:'',fecha_local:'',notas:''});
   setAppointmentOpen(true);
  }catch{setStatus('No se pudieron cargar las opciones de citas');}
  finally{setAppointmentBusy(false);}
 }
 async function createAppointment(){
  const f=appointmentForm;
  if(!f.name.trim()||!f.advisor_id||!f.fecha_local){setStatus('Completa cliente, asesor y fecha');return;}
  setAppointmentBusy(true);
  try{
   const result=await appointmentRequest('create',{name:f.name,phone:f.phone,email:f.email,advisor_id:f.advisor_id,property_id:f.property_id||null,fecha_hora:new Date(f.fecha_local).toISOString(),notas:f.notas});
   setStatus(result.kpi_synced?'Cita agendada':'Cita agendada · KPI pendiente de sincronizar');
   setAppointmentOpen(false);await loadAppointments();
  }catch{setStatus('No se pudo agendar la cita');}
  finally{setAppointmentBusy(false);}
 }
 async function cancelAppointment(id){
  if(!window.confirm('¿Cancelar esta cita?'))return;
  setAppointmentBusy(true);
  try{const r=await appointmentRequest('cancel',{appointment_id:id});setStatus(r.kpi_synced?'Cita cancelada':'Cita cancelada · KPI pendiente');await loadAppointments();}
  catch{setStatus('No se pudo cancelar la cita');}
  finally{setAppointmentBusy(false);}
 }
 const [refreshing,setRefreshing]=useState(false);
 const [outbox,setOutbox]=useState([]);
 const outboxRef=useRef([]);
 function setOutboxSafe(updater){setOutbox(old=>{const next=typeof updater==='function'?updater(old):updater;outboxRef.current=next;return next;});}
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
  setRefreshing(true);
  try{const r=await inboxRequest('facebook','history',{thread});if(!mounted.current)return;
   const items=Array.isArray(r.rows)?r.rows:[];
   setRows(items);setEnabled(r.sender_enabled===true);
   // Reconcile only confirmed outbound echoes after the local send started.
   const echoes=items.filter(x=>x.kind==='echo'&&typeof x.text==='string');
   setOutboxSafe(old=>{
    const consumed=new Set(old.filter(o=>o.echoInput).map(o=>o.echoInput));
    return old.map(item=>{
    if(item.state!=='accepted')return item;
    const match=echoes.find(x=>!consumed.has(x.input)&&x.text===item.text&&Date.parse(x.occurred_at)>=item.startedAt-10000);
    if(match){consumed.add(match.input);return {...item,state:'confirmed',echoInput:match.input};}
    return item;
   });
   });
   if(!locked.current){const latest=[...items].reverse().find(item=>item.can_reply===true&&item.kind==='inbound');
    setInput(previous=>items.some(item=>item.input===previous&&item.can_reply===true)?previous:(latest?.input||''));}
  }catch{if(mounted.current){setRows([]);setInput('');setEnabled(false);setStatus('Historial no disponible o acceso no autorizado.');}}
  finally{if(mounted.current)setRefreshing(false);}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[thread]);
 async function send(e){
  e.preventDefault();
  const message=text.trim();
  if(locked.current||!enabled||!message||!rows.some(r=>r.input===input&&r.can_reply))return;
  const action=crypto.randomUUID(),startedAt=Date.now();
  locked.current=true;setBusy(true);setStatus('');
  setOutboxSafe(old=>[...old,{action,text:message,startedAt,state:'sending'}]);
  setText('');
  try{
   const result=await inboxRequest('facebook','reply',{body:{action,input,text:message}});
   const state=result.status==='accepted'?'accepted':result.status==='failed'?'failed':'uncertain';
   if(mounted.current){
    setOutboxSafe(old=>old.map(x=>x.action===action?{...x,state}:x));
    setStatus(state==='accepted'?'Meta aceptó el envío. Esperando confirmación en el historial.':
     state==='failed'?'Meta rechazó este envío; no se reenviará automáticamente.':
     'Resultado incierto. No volver a enviar hasta revisar el registro.');
   }
   if(state==='accepted')locked.current=false;
  }catch{
   if(mounted.current){
    setOutboxSafe(old=>old.map(x=>x.action===action?{...x,state:'uncertain'}:x));
    setStatus('Resultado incierto. No vuelvas a enviar hasta revisar el registro.');
   }
  }finally{if(mounted.current){setBusy(false);await refresh();}}
  // Every click creates one durable action. An uncertain attempt stays locked.
 }

 return <section className="fbConversation" aria-label="Conversación Facebook Messenger">
  <div className="fbWorkspace"><div className="fbChat"><header className="fbHeader"><div><strong>{displayName||'Contacto de Facebook'}</strong><span>Facebook Messenger · </span><span>{enabled?'Atención manual habilitada':'Sólo lectura · Envío desactivado'} · Sin IA</span></div><div className="fbActions"><button type="button" className="mobileDetails" onClick={()=>setDetailsOpen(v=>!v)}>Ficha</button><button type="button" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?'Actualizando…':'↻ Actualizar'}</button></div></header>
  {nameStatus&&<p role="status" className="nameStatus">{nameStatus}</p>}
  <div className="history" role="log" aria-label="Mensajes de Facebook">
   {!rows.length&&<p className="emptyHistory">No hay mensajes disponibles para esta conversación.</p>}
   {rows.map(r=><div key={r.input} className={r.kind==='echo'?'messageRow mine':'messageRow theirs'}>
    <article className={r.kind==='echo'?'bubble outgoing':'bubble'}>
     {r.text&&<FacebookLinkifiedText value={r.text}/>}{(r.attachment_types||[]).slice(0,5).map((type,index)=>r.kind==='echo'?<div key={r.input+':'+index} className="outboundMediaReceipt">{type==='audio'?'🎤 Audio':type==='image'?'🖼️ Imagen':type==='video'?'🎬 Video':'📎 Archivo'} enviado por Messenger · vista previa pendiente</div>:<FacebookReceivedMedia key={r.input+':'+index} input={r.input} index={index} type={type}/>)}{!r.text&&!r.attachment_types?.length&&<p>Evento recibido</p>}
     <footer><time>{new Date(r.occurred_at).toLocaleString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time>{r.outcome&&<span> · {r.outcome}</span>}</footer>
     {enabled&&r.can_reply&&<button type="button" className="pickReply" disabled={busy||locked.current} aria-pressed={input===r.input} onClick={()=>setInput(r.input)}>{input===r.input?'Seleccionado':'Responder a este mensaje'}</button>}
    </article>
   </div>)}
   {outbox.filter(o=>o.state!=='confirmed').map(o=><div key={o.action} className="messageRow mine">
    <article className="bubble outgoing pendingBubble"><p>{o.text}</p><footer><span>{o.state==='sending'?'Enviando…':o.state==='accepted'?'Aceptado por Meta · esperando historial':o.state==='failed'?'Envío rechazado':'Resultado incierto · no reenviar'}</span></footer></article>
   </div>)}
  </div>
  {enabled?<form onSubmit={send} className="composer"><label htmlFor="facebook-reply-text">Respuesta manual</label><small className="replyHint">{input?'Ventana activa · cada mensaje se registra y envía una sola vez':'No hay mensaje entrante elegible para responder en esta conversación'}</small>{appointmentRows.map(a=><div key={a.id} style={{fontSize:12,padding:6,borderBottom:'1px solid #eee'}}>📅 {new Date(a.fecha_hora).toLocaleString('es-MX')} · {a.estado}{a.estado!=='cancelada'&&<button type="button" disabled={appointmentBusy} onClick={()=>cancelAppointment(a.id)}>Cancelar</button>}</div>)}
  {appointmentOpen&&typeof document!=='undefined'&&createPortal(
   <div role="presentation" style={{position:'fixed',inset:0,zIndex:2147483000,background:'rgba(15,23,42,.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:'max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom))',boxSizing:'border-box'}}>
    <section role="dialog" aria-modal="true" aria-label="Agendar cita de Facebook" style={{display:'flex',flexDirection:'column',width:'min(540px,100%)',maxHeight:'min(90dvh,800px)',minHeight:0,overflow:'hidden',borderRadius:14,background:'#fff',boxShadow:'0 18px 55px rgba(0,0,0,.25)',color:'#263348'}}>
     <header style={{padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #e5e7eb',flexShrink:0}}>
      <strong>Agendar cita</strong><button type="button" onClick={()=>setAppointmentOpen(false)} aria-label="Cerrar cita" style={{border:0,background:'transparent',fontSize:24,cursor:'pointer'}}>×</button>
     </header>
     <div style={{padding:'14px 18px',overflowY:'auto',overscrollBehavior:'contain',flex:'1 1 auto',minHeight:0}}>
      {['name','phone','email','fecha_local','notas'].map(k=><label key={k} style={{display:'block',fontSize:13,marginBottom:12}}>{({name:'Nombre',phone:'Teléfono',email:'Correo',fecha_local:'Fecha y hora',notas:'Notas'})[k]}<input type={k==='fecha_local'?'datetime-local':'text'} value={appointmentForm[k]} onChange={e=>setAppointmentForm(f=>({...f,[k]:e.target.value}))} style={{display:'block',width:'100%',boxSizing:'border-box',minHeight:40,marginTop:5,padding:9,border:'1px solid #cbd5e1',borderRadius:8,fontSize:14}}/></label>)}
      <label style={{display:'block',fontSize:13,marginBottom:12}}>Asesor<select value={appointmentForm.advisor_id} onChange={e=>setAppointmentForm(f=>({...f,advisor_id:e.target.value}))} style={{display:'block',width:'100%',minHeight:40,marginTop:5}}><option value="">Seleccionar</option>{appointmentAdvisors.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label style={{display:'block',fontSize:13,marginBottom:12}}>Propiedad<select value={appointmentForm.property_id} onChange={e=>setAppointmentForm(f=>({...f,property_id:e.target.value}))} style={{display:'block',width:'100%',minHeight:40,marginTop:5}}><option value="">Sin propiedad</option>{appointmentProperties.map(p=><option key={p.id} value={p.id}>{p.titulo}</option>)}</select></label>
     </div>
     <footer style={{display:'flex',gap:10,padding:'12px 18px max(12px,env(safe-area-inset-bottom))',flexShrink:0,borderTop:'1px solid #e5e7eb',background:'#fff'}}>
      <button type="button" disabled={appointmentBusy} onClick={createAppointment} style={{flex:1,minHeight:44,border:0,borderRadius:9,background:'#ae2148',color:'#fff',fontWeight:700,cursor:'pointer'}}>Guardar cita</button>
      <button type="button" onClick={()=>setAppointmentOpen(false)} style={{flex:1,minHeight:44,border:'1px solid #cbd5e1',borderRadius:9,background:'#fff',color:'#334155',cursor:'pointer'}}>Cerrar</button>
     </footer>
    </section>
   </div>,document.body)}
  {propertyPicker&&<div className="fbPropertyPicker" style={{border:'1px solid #ddd',padding:10,borderRadius:10,marginBottom:8}}>
   <div style={{display:'flex',justifyContent:'space-between'}}><strong>Compartir propiedad</strong><button type="button" onClick={()=>setPropertyPicker(false)} aria-label="Cerrar propiedades">×</button></div>
   <input aria-label="Buscar propiedad" placeholder="Buscar por nombre o colonia" value={propertySearch} onChange={e=>setPropertySearch(e.target.value)} style={{width:'100%',padding:8,margin:'8px 0'}}/>
   <div className="fbPropertyList" style={{maxHeight:220,overflowY:'auto'}}>{propertyLoading?'Cargando…':propertyRows.filter(p=>(p.titulo+' '+p.colonia+' '+p.ciudad).toLowerCase().includes(propertySearch.toLowerCase())).slice(0,30).map(p=><button type="button" key={p.id} onClick={()=>toggleProperty(p)} style={{display:'block',width:'100%',height:'auto',borderRadius:6,textAlign:'left',padding:9,marginBottom:4}}>{propertyChoices.some(x=>x.id===p.id)?'☑':'☐'} {p.titulo} · {p.colonia||p.ciudad||''}</button>)}</div>
   <div className="fbPropertyFooter" style={{display:'flex',gap:8,alignItems:'center',paddingTop:8}}><span>{propertyChoices.length}/5 seleccionadas</span><button type="button" disabled={!propertyChoices.length} onClick={prepareProperties}>Preparar mensaje</button></div><small>Revisa las opciones y pulsa Enviar. No se enviará automáticamente.</small>
  </div>}
  {pendingMedia&&<div style={{display:'flex',alignItems:'center',gap:8,padding:8}}>
    <span>{pendingMedia.name} · {(pendingMedia.size/1024/1024).toFixed(1)} MB</span>
    <button type="button" onClick={clearPending} disabled={busy}>Cancelar</button>
    <button type="button" onClick={sendMedia} disabled={busy||locked.current||!rows.some(r=>r.input===input&&r.can_reply)}>Enviar archivo</button>
   </div>}
   {recording&&<div><span>● Grabando nota de voz</span><button type="button" onClick={()=>stopRecording(false)}>Detener</button><button type="button" onClick={()=>stopRecording(true)}>Cancelar</button></div>}
   <div className="composeRow"><button type="button" title="Agendar cita" onClick={()=>void openAppointment()} disabled={busy||appointmentBusy}>📅</button><input type="file" ref={mediaInputRef} accept="image/jpeg,image/png,image/webp,video/mp4" hidden onChange={e=>selectMedia(e.target.files?.[0])}/>
   <button type="button" title="Adjuntar foto o video" disabled={busy||recording} onClick={()=>mediaInputRef.current?.click()}>＋</button>
   <button type="button" title="Grabar nota de voz" disabled={busy||recording||!!pendingMedia} onClick={startRecording}>🎤</button>
   <button type="button" title="Enviar propiedad" aria-label="Enviar propiedad" disabled={busy||locked.current||!rows.some(r=>r.input===input&&r.can_reply)} onClick={openProperties}>🏠</button><textarea id="facebook-reply-text" value={text} onChange={e=>setText(e.target.value)} maxLength={1000} disabled={busy||locked.current} placeholder="Escribe una respuesta…"/><button type="submit" disabled={busy||locked.current||!rows.some(r=>r.input===input&&r.can_reply)||!text.trim()} aria-label="Enviar una vez">➤</button></div></form>:<div className="readOnly">Las conversaciones recuperadas se pueden consultar. Los envíos siguen desactivados hasta terminar las pruebas de permisos.</div>}
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
   .fbConversation{position:relative;height:100%;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden;background:#f8fafc}.fbWorkspace{display:grid;grid-template-columns:minmax(0,1fr);flex:1;min-height:0;overflow:hidden}.fbChat{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
   .fbHeader{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;background:#fff;border-bottom:1px solid #e5e7eb}.fbHeader div{display:flex;flex-direction:column;gap:4px}.fbHeader strong{font-size:14px;color:#263348}.fbHeader span{font-size:11px;color:#64748b}.fbHeader button{background:white;border:1px solid #e5e7eb;border-radius:9px;padding:8px 11px;color:#475569;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap}
   .fbDetails{display:none;position:absolute;right:0;top:0;bottom:0;width:min(340px,90%);z-index:20;min-width:0;min-height:0;flex-direction:column;border-left:1px solid #e5e7eb;background:#fff;box-shadow:-16px 0 38px #0f172a26}.fbDetails.open{display:flex}.detailsHeading{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e7eb}.detailsHeading strong{font-size:14px}.detailsHeading button{display:block;border:0;background:transparent;font-size:22px;cursor:pointer}.detailsScroll{overflow-y:auto;min-height:0;flex:1;overscroll-behavior:contain}.profileCard{display:flex;flex-direction:column;align-items:center;text-align:center;gap:7px;padding:22px 12px;border-bottom:1px solid #edf0f4}.profileCard strong{font-size:13px;overflow-wrap:anywhere}.profileCard small{color:#94a3b8;font-size:11px}.fbAvatar{width:55px;height:55px;border-radius:50%;background:#1877f2;color:white;display:grid;place-items:center;font-size:34px;font-weight:700}.detailBlock{padding:15px;border-bottom:1px solid #edf0f4}.detailBlock label{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:9px}.detailBlock p{margin:0;font-size:12px;color:#475569;line-height:1.55}.detailBlock small{display:block;margin-top:6px;font-size:10px;color:#94a3b8}.editFields{display:flex;flex-direction:column;gap:7px}.editFields select{min-width:0;width:100%;box-sizing:border-box;border:1px solid #dbe1ea;border-radius:8px;padding:9px;font-size:12px}.editFields input{min-width:0;width:100%;box-sizing:border-box;border:1px solid #dbe1ea;border-radius:8px;padding:9px;font-size:12px}.editFields input:disabled{background:#f8fafc}.editFields button{background:#ae2148;color:white;border:0;border-radius:8px;padding:9px;font-weight:700;font-size:11px;cursor:pointer}.editFields button:disabled{opacity:.5}.mobileDetails{display:inline-block}
   .fbActions{display:flex;gap:6px}.nameEditor{display:flex;gap:8px;background:#fff;padding:8px 14px;border-bottom:1px solid #e5e7eb}.nameEditor input{flex:1;min-width:0;border:1px solid #dbe1ea;border-radius:8px;padding:8px;font-size:12px}.nameEditor button{border:0;background:#a51d40;color:#fff;border-radius:8px;padding:8px 12px;font-size:11px;cursor:pointer}.nameEditor button:disabled{opacity:.5}.nameStatus{margin:0;padding:5px 14px;font-size:11px;color:#64748b;background:white}
   .history{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;padding:18px;align-content:start}
   .pendingBubble{opacity:.8}.pendingBubble footer{font-weight:700}.messageRow{display:flex;width:100%}.messageRow.theirs{justify-content:flex-start}.messageRow.mine{justify-content:flex-end}
   .bubble{width:fit-content;max-width:min(70%,460px);border:1px solid #e2e8f0;background:#fff;border-radius:15px 15px 15px 4px;padding:11px 13px;box-sizing:border-box;overflow-wrap:anywhere}.outgoing{background:#e3efff;border-color:#cfe0fd;border-radius:15px 15px 4px 15px}
   .bubble p{white-space:pre-wrap;font-size:12.5px;line-height:1.45;margin:0;color:#263348}.bubble footer{display:block;text-align:right;margin-top:6px;color:#94a3b8;font-size:10px}.emptyHistory{color:#64748b;font-size:12px;text-align:center;margin:auto}
   .pickReply{margin-top:9px;background:transparent;border:0;color:#a51d40;font-size:11px;font-weight:700;cursor:pointer}
   .replyHint{display:block;font-size:10px;color:#64748b;margin:-3px 0 8px}.composer{flex-shrink:0;background:#fff;padding:12px 16px;border-top:1px solid #e5e7eb}.composer label{display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:7px}.composeRow{display:flex;align-items:flex-end;gap:9px}.composer textarea{flex:1;min-width:0;resize:vertical;min-height:48px;max-height:116px;padding:12px;border:1px solid #dbe1ea;border-radius:12px;font:inherit;font-size:13px}.composer button{min-width:38px;min-height:38px;border-radius:12px;background:#ae2148;color:#fff;border:0;font-size:13px;cursor:pointer;padding:7px 10px;white-space:normal;overflow-wrap:normal}.composeRow>button{flex:0 0 38px;width:38px;height:38px;padding:0;border-radius:50%;font-size:18px}.composer button:not(.composeRow>button){width:auto;height:auto}.composer label input,.composer label select{box-sizing:border-box;max-width:100%;min-height:36px}.fbAppointmentPanel{min-height:0;scrollbar-width:thin}.fbAppointmentFooter button{flex:1;min-width:0}.outboundMediaReceipt{padding:9px 10px;background:#eef4ff;border-radius:8px;font-size:12px;color:#42516a}.composer label{line-height:1.4}.composer .fbPropertyPicker button{max-width:100%} 
   /* Desktop Inbox has a height-constrained chat pane: keep the property picker
      and its confirmation visible, independently scrolling only its results. */
   @media(min-width:1001px){
    .fbPropertyPicker{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000;
      width:min(520px,calc(100vw - 48px));max-height:min(66vh,540px);box-sizing:border-box;
      display:flex;flex-direction:column;min-height:0;background:#fff;
      box-shadow:0 18px 55px rgba(15,23,42,.28)}
    .fbPropertyPicker .fbPropertyList{flex:1;min-height:40px;overflow-y:auto;max-height:none!important}
    .fbPropertyPicker .fbPropertyFooter{flex-shrink:0;flex-wrap:wrap;background:#fff}
    .fbAppointmentPanel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:1001;width:min(540px,calc(100vw - 48px));box-sizing:border-box;
      max-height:min(82vh,760px)!important;overflow-y:auto!important;
      background:#fff;box-shadow:0 18px 55px rgba(15,23,42,.28);
      padding-bottom:14px!important}
    .fbAppointmentPanel .fbAppointmentFooter{position:sticky;bottom:0;z-index:2;
      display:flex;flex-shrink:0;background:#fff;border-top:1px solid #e5e7eb;
      padding:12px 0!important}
    .fbAppointmentPanel label{display:block;margin:8px 0}
    .fbAppointmentPanel label input,.fbAppointmentPanel label select{width:100%;min-width:0}

   }.composer button:disabled{background:#cbd5e1;cursor:not-allowed}
   .readOnly{flex-shrink:0;padding:12px 18px;background:#fff;border-top:1px solid #e5e7eb;font-size:11px;color:#64748b;line-height:1.5}
   .status{margin:0;padding:9px 18px;background:#fff7ed;color:#9a3412;font-size:11px}
   @media(max-width:1000px){.fbWorkspace{grid-template-columns:minmax(0,1fr)}.fbDetails{display:none;position:absolute;right:0;top:0;bottom:0;width:min(330px,90%);z-index:5;box-shadow:-12px 0 28px #0f172a21}.fbDetails.open{display:flex}.fbConversation{position:relative}.mobileDetails{display:inline-block}.detailsHeading button{display:block;border:0;background:transparent;font-size:22px;cursor:pointer}}@media(max-width:760px){.fbHeader{padding:10px 12px}.history{padding:12px}.bubble{max-width:87%}}
  `}</style>
 </section>;
}
