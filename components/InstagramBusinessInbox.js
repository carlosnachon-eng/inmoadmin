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
const money=value=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(Number(value)||0);
const messageStamp=value=>{
 const d=new Date(value),now=new Date();
 const key=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(x);
 return key(d)===key(now)?clock(value):`${day(value)} · ${clock(value)}`;
};

function LinkifiedText({text}){
 const parts=String(text||'').split(/(https?:\/\/[^\s]+)/g);
 return <p>{parts.map((part,i)=>/^https?:\/\/[^\s]+$/i.test(part)
  ?<a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
  :part)}</p>;
}

function Media({thread,input,index,type,onOpen,onLoaded}){
 const [url,setUrl]=useState(null);
 useEffect(()=>{
  let active=true,object;
  request('media',{query:{thread,input,index:String(index)},binary:true})
   .then(blob=>{object=URL.createObjectURL(blob);if(active)setUrl(object);else URL.revokeObjectURL(object);})
   .catch(()=>{});
  return()=>{active=false;if(object)URL.revokeObjectURL(object);};
 },[thread,input,index]);
 if(!url)return <div className="mediaPlaceholder">Adjunto no disponible</div>;
 if(type==='audio')return <audio controls preload="metadata" src={url} onLoadedMetadata={()=>onLoaded?.()} style={{display:'block',width:'260px',maxWidth:'100%'}}/>;
 if(type==='video')return <video controls preload="metadata" src={url} onLoadedMetadata={()=>onLoaded?.()}
  style={{display:'block',width:'260px',maxWidth:'100%',maxHeight:'220px',borderRadius:'12px',background:'#000'}}/>;
 return <button type="button" onClick={()=>onOpen?.(url)}
  style={{border:0,background:'transparent',padding:0,cursor:'zoom-in',maxWidth:'100%',display:'block'}}>
  <img src={url} alt="Imagen recibida en Instagram" onLoad={()=>onLoaded?.()}
   style={{display:'block',width:'auto',height:'auto',maxWidth:'160px',maxHeight:'140px',objectFit:'contain',background:'#f3f4f6',borderRadius:'12px',marginBottom:'7px'}}/>
 </button>;
}

export default function InstagramBusinessInbox(){
 function scrollChatBottom(behavior='auto'){
  requestAnimationFrame(()=>requestAnimationFrame(()=>bottomRef.current?.scrollIntoView({block:'end',behavior})));
 }
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
 const [threadFilter,setThreadFilter]=useState('all');
 const [notifications,setNotifications]=useState({rows:[],unread_count:0});
 const [aliasDraft,setAliasDraft]=useState(''),[aliasBusy,setAliasBusy]=useState(false),[mobileAliasEditing,setMobileAliasEditing]=useState(false);
 const [profile,setProfile]=useState(null),[syncing,setSyncing]=useState(false),[uncertainLocked,setUncertainLocked]=useState(false);
 const [phoneDraft,setPhoneDraft]=useState(''),[emailDraft,setEmailDraft]=useState(''),[contactBusy,setContactBusy]=useState(false),[lightbox,setLightbox]=useState(null),[pendingMedia,setPendingMedia]=useState(null),[optimistic,setOptimistic]=useState([]),[recording,setRecording]=useState(false),[recordSeconds,setRecordSeconds]=useState(0);
 const [propertyPicker,setPropertyPicker]=useState(false),[propertyRows,setPropertyRows]=useState([]),[propertySearch,setPropertySearch]=useState(''),[propertyChoices,setPropertyChoices]=useState([]),[propertyBusy,setPropertyBusy]=useState(false);
 const [appointmentRows,setAppointmentRows]=useState([]),[appointmentOpen,setAppointmentOpen]=useState(false),[appointmentAdvisors,setAppointmentAdvisors]=useState([]),[appointmentBusy,setAppointmentBusy]=useState(false),[appointmentCancelBusy,setAppointmentCancelBusy]=useState(null),[clientMatches,setClientMatches]=useState([]),[clientMatchBusy,setClientMatchBusy]=useState(false),[selectedClientMatch,setSelectedClientMatch]=useState(null);
 const [appointmentForm,setAppointmentForm]=useState({name:'',phone:'',email:'',property_id:'',advisor_id:'',fecha_local:'',notas:''});
 const [assignment,setAssignment]=useState({advisor_id:null,advisor_name:null,source:null}),[assignmentOptions,setAssignmentOptions]=useState([]),[assignmentDraft,setAssignmentDraft]=useState(''),[assignmentBusy,setAssignmentBusy]=useState(false);
 const lock=useRef(false),generation=useRef(0),chatRef=useRef(null),bottomRef=useRef(null),mediaInputRef=useRef(null),polling=useRef(false),selectedRef=useRef(null),recorderRef=useRef(null),recordChunksRef=useRef([]),recordTimerRef=useRef(null),recordStreamRef=useRef(null);

 const filtered=useMemo(()=>{
  const q=search.trim().toLowerCase();
  return threads.filter((t,i)=>{
   const matchesText=!q||`instagram conversación ${i+1} ${t.thread_ref} ${t.alias||''} ${t.profile_name||''} ${t.profile_username||''} ${t.assigned_advisor_name||''} ${t.plaza_name||''}`.toLowerCase().includes(q);
   const matchesFilter=threadFilter==='all'
    ||(threadFilter==='unassigned'&&!t.assigned_advisor_id)
    ||(threadFilter==='puebla'&&t.plaza_name==='Puebla')
    ||(threadFilter==='veracruz'&&t.plaza_name==='Veracruz');
   return matchesText&&matchesFilter;
  });
 },[threads,search,threadFilter]);

 const unreadThreads=useMemo(()=>new Set((notifications.rows||[]).filter(n=>!n.read_at).map(n=>n.thread_ref)),[notifications]);

 const filteredProperties=useMemo(()=>{
  const q=propertySearch.trim().toLowerCase();
  if(!q)return propertyRows;
  return propertyRows.filter(p=>[p.public_id,p.titulo,p.tipo,p.colonia,p.ciudad,p.operacion].filter(Boolean).join(' ').toLowerCase().includes(q));
 },[propertyRows,propertySearch]);

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
    setAppointmentRows(r.appointments||[]);
    setAssignment(r.assignment||{advisor_id:null,advisor_name:null,source:null});
    setAssignmentDraft(r.assignment?.advisor_id||'');
    setSelected(thread);
    if(unreadThreads.has(thread)){
     setNotifications(v=>({...v,rows:(v.rows||[]).map(n=>n.thread_ref===thread?{...n,read_at:new Date().toISOString()}:n),unread_count:Math.max(0,(v.unread_count||0)-1)}));
     void request('notification-read',{body:{thread}}).catch(()=>{});
    }
    setProfile(r.profile||null);
    if(r.profile) setThreads(list=>list.map(t=>t.thread_ref===thread?{...t,profile_name:r.profile.name||null,profile_username:r.profile.username||null,profile_pic:r.profile.profile_pic||null}:t));
    const current=threads.find(t=>t.thread_ref===thread);
    setAliasDraft(current?.alias||'');
    try{const contact=await request('contact-get',{query:{thread}});setPhoneDraft(contact.phone||'');setEmailDraft(contact.email||'');}catch{setPhoneDraft('');setEmailDraft('');}
    try{const a=await request('assignment-get',{query:{thread}});setAssignment(a.current||{advisor_id:null,advisor_name:null,source:null});setAssignmentDraft(a.current?.advisor_id||'');setAssignmentOptions(a.options||[]);}catch{setAssignmentOptions([]);}
    setInput(null);
    setUncertainLocked(false);
    setText('');
    scrollChatBottom('auto');
   }else{
    setThreads(r.rows||[]);
    try{const n=await request('notifications');setNotifications(n||{rows:[],unread_count:0});}catch{}
    if(!selected&&r.rows?.length){if(!quiet)setBusy(false);void load(r.rows[0].thread_ref,{quiet:true});}
   }
  }catch(e){if(gen===generation.current)setStatus(e.message);}
  finally{if(gen===generation.current&&!quiet)setBusy(false);}
 }

 useEffect(()=>{selectedRef.current=selected;},[selected]);
 useEffect(()=>{
  if(!optimistic.length)return;
  setOptimistic(list=>list.filter(o=>!rows.some(r=>{
   if(r.direction==='customer_inbound')return false;
   const when=Date.parse(r.occurred_at);
   if(!Number.isFinite(when)||when<o.sentAt-5000)return false;
   if(o.kind==='text')return r.text===o.text;
   if(o.kind==='image')return r.attachments?.some(a=>a.type==='image');
   if(o.kind==='video')return r.attachments?.some(a=>a.type==='video');
   return o.kind==='audio'&&r.attachments?.some(a=>a.type==='audio');
  })));
 },[rows]);
 useEffect(()=>{if(selected&&(rows.length||optimistic.length))scrollChatBottom('auto');},[selected,rows.length,optimistic.length]);
 useEffect(()=>{void load();},[]);
 useEffect(()=>{
  const tick=async()=>{
   if(polling.current||lock.current||document.visibilityState!=='visible')return;
   polling.current=true;
   try{
    const [t,n]=await Promise.all([request('threads'),request('notifications').catch(()=>null)]);
    setEnabled(!!t.sender_enabled);
    setThreads(t.rows||[]);
    if(n)setNotifications(n);
    const current=selectedRef.current;
    if(current){
     const h=await request('history',{query:{thread:current}});
     setEnabled(!!h.sender_enabled);
     setRows(h.rows||[]);
     setAppointmentRows(h.appointments||[]);
     setAssignment(h.assignment||{advisor_id:null,advisor_name:null,source:null});
     setAssignmentDraft(h.assignment?.advisor_id||'');
     setProfile(h.profile||null);
     if(h.profile)setThreads(list=>list.map(x=>x.thread_ref===current?{...x,profile_name:h.profile.name||null,profile_username:h.profile.username||null,profile_pic:h.profile.profile_pic||null}:x));
    }
   }catch{/* Keep the current Inbox visible; manual refresh can surface errors. */}
   finally{polling.current=false;}
  };
  const id=setInterval(tick,15000);
  return()=>clearInterval(id);
 },[]);

 async function openPropertyPicker(){
  if(!enabled||!replyAnchor||uncertainLocked||busy)return;
  setPropertyPicker(true);setPropertyChoices([]);setPropertySearch('');
  if(propertyRows.length)return;
  setPropertyBusy(true);
  try{const r=await request('properties');setPropertyRows(r.rows||[]);}
  catch{setStatus('No fue posible cargar las propiedades');setPropertyPicker(false);}
  finally{setPropertyBusy(false);}
 }

 const short=(value,max)=>String(value||'').length>max?String(value).slice(0,max-1).trimEnd()+'…':String(value||'');
 const propertyMessage=items=>{
  const rows=items.map((p,i)=>{
   const url=`https://www.emporioinmobiliario.com.mx/propiedades/${p.public_id}`;
   const place=short([p.colonia,p.ciudad].filter(Boolean).join(', '),42);
   const op=p.operacion==='sale'?'Venta':'Renta';
   return `${i+1}. ${short(p.titulo,58)}\n${money(p.precio)} · ${op}${place?` · ${place}`:''}\n${url}`;
  });
  return `Te comparto estas opciones:\n\n${rows.join('\n\n')}`;
 };
 const toggleProperty=p=>setPropertyChoices(list=>{
  if(list.some(x=>x.id===p.id))return list.filter(x=>x.id!==p.id);
  if(list.length>=5){setStatus('Puedes enviar hasta 5 propiedades por mensaje');return list;}
  return [...list,p];
 });

 async function sendProperty(){
  if(!propertyChoices.length||lock.current||!enabled||!replyAnchor||uncertainLocked)return;
  const message=propertyMessage(propertyChoices),action=crypto.randomUUID();
  if(new TextEncoder().encode(message).length>980){setStatus('La selección quedó demasiado larga; quita una propiedad');return;}
  lock.current=true;setPropertyBusy(true);setStatus('Enviando propiedad…');
  try{
   const r=await submitBusinessReply({request,thread:selected,input:replyAnchor,action,text:message});
   if(r.status==='accepted'){
    const nowIso=new Date().toISOString();
    setOptimistic(list=>[...list,{id:'local-'+action,kind:'text',text:message,occurred_at:nowIso,sentAt:Date.now(),status:'Enviado'}]);
    setPropertyPicker(false);setPropertyChoices([]);setPropertySearch('');
    setInput(null);setStatus('Propiedad enviada');setUncertainLocked(false);scrollChatBottom('smooth');
    void load(null,{quiet:true});
   }else if(r.status==='uncertain'){
    setUncertainLocked(true);setStatus('Resultado incierto · revisa Instagram antes de enviar otro mensaje');
   }else setStatus(r.status||'No fue posible enviar la propiedad');
  }catch{setUncertainLocked(true);setStatus('Resultado incierto · revisa Instagram antes de enviar otro mensaje');}
  finally{lock.current=false;setPropertyBusy(false);}
 }

 async function saveAssignment(){
  if(!selected||!assignmentDraft||assignmentBusy)return;
  setAssignmentBusy(true);setStatus('');
  try{
   const r=await request('assignment-set',{body:{thread:selected,advisor_id:assignmentDraft}});
   setAssignment({advisor_id:r.advisor_id,advisor_name:r.advisor_name,source:r.source||'manual'});
   setStatus(r.source==='crm'?'Cliente reasignado en CRM':'Conversación asignada');
  }catch(e){setStatus(e?.message==='advisor_invalid'?'Asesor no válido':'No fue posible guardar la asignación');}
  finally{setAssignmentBusy(false);}
 }

 async function openAppointment(){
  if(!selected||busy||uncertainLocked)return;
  setAppointmentBusy(true);
  try{
   const [{data:sessionData},options,props]=await Promise.all([
    supabase.auth.getSession(),
    request('appointment-options'),
    propertyRows.length?Promise.resolve({rows:propertyRows}):request('properties')
   ]);
   const advisors=options.advisors||[],properties=props.rows||[];
   if(!propertyRows.length)setPropertyRows(properties);
   const currentId=sessionData?.session?.user?.id;
   const defaultAdvisor=assignment?.advisor_id||advisors.find(a=>a.id===currentId)?.id||advisors[0]?.id||'';
   setAppointmentAdvisors(advisors);
   setAppointmentForm({
    name:(aliasDraft||profile?.name||profile?.username||'Cliente Instagram').replace(/^@/,''),
    phone:phoneDraft||'',email:emailDraft||'',property_id:'',advisor_id:defaultAdvisor,fecha_local:'',notas:''
   });
   setAppointmentOpen(true);
  }catch{setStatus('No fue posible abrir el módulo de citas');}
  finally{setAppointmentBusy(false);}
 }

 useEffect(()=>{
  if(!appointmentOpen)return;
  const phone=appointmentForm.phone.trim(),email=appointmentForm.email.trim();
  if(!phone&&!email){setClientMatches([]);setSelectedClientMatch(null);return;}
  const t=setTimeout(async()=>{
   setClientMatchBusy(true);
   try{
    const r=await request('client-match',{body:{phone,email}});
    setClientMatches(r.rows||[]);
    if(selectedClientMatch&&!r.rows?.some(x=>x.id===selectedClientMatch.id))setSelectedClientMatch(null);
   }catch{setClientMatches([]);}
   finally{setClientMatchBusy(false);}
  },400);
  return()=>clearTimeout(t);
 },[appointmentOpen,appointmentForm.phone,appointmentForm.email]);

 function useClientMatch(c){
  setSelectedClientMatch(c);
  setAppointmentForm(v=>({...v,name:c.nombre||v.name,phone:c.telefono||v.phone,email:c.correo||v.email,advisor_id:c.asesor_id||v.advisor_id}));
 }
 async function createAppointment(){
  if(appointmentBusy||!selected)return;
  const f=appointmentForm;
  if(!f.name.trim()){setStatus('Captura el nombre del cliente');return;}
  if(!f.advisor_id){setStatus('Selecciona un asesor');return;}
  if(!f.fecha_local){setStatus('Selecciona fecha y hora');return;}
  const when=new Date(f.fecha_local);
  if(!Number.isFinite(when.getTime())){setStatus('Fecha u hora inválida');return;}
  setAppointmentBusy(true);setStatus('Agendando cita…');
  try{
   const r=await request('appointment-create',{body:{
    thread:selected,client_id:selectedClientMatch?.id||null,name:f.name.trim(),phone:f.phone.trim(),email:f.email.trim(),
    property_id:f.property_id||null,advisor_id:f.advisor_id,fecha_hora:when.toISOString(),notas:f.notas.trim()
   }});
   if(r.status!=='created')throw Error('appointment_failed');
   setAppointmentOpen(false);
   setStatus(r.kpi_synced===false?'Cita agendada · KPI pendiente de sincronizar':'Cita agendada');
   await load(selected,{quiet:true});
  }catch(e){setStatus(e?.message==='advisor_invalid'?'Asesor no válido':e?.message==='property_invalid'?'La propiedad ya no está publicada':'No fue posible agendar la cita');}
  finally{setAppointmentBusy(false);}
 }

 async function cancelAppointment(id){
  if(!selected||appointmentCancelBusy)return;
  if(!window.confirm('¿Cancelar esta cita? Quedará registrada como cancelada.'))return;
  setAppointmentCancelBusy(id);setStatus('Cancelando cita…');
  try{
   const r=await request('appointment-cancel',{body:{thread:selected,appointment_id:id}});
   if(r.status!=='cancelled')throw Error('appointment_cancel_failed');
   setStatus(r.kpi_synced===false?'Cita cancelada · KPI pendiente de sincronizar':'Cita cancelada');
   await load(selected,{quiet:true});
  }catch{setStatus('No fue posible cancelar la cita');}
  finally{setAppointmentCancelBusy(null);}
 }

 async function syncHistory(){
  if(syncing)return;
  setSyncing(true);setHistoryStatus('Recuperando historial reciente…');
  try{
   const r=await request('history-sync',{body:{}});
   setHistoryStatus(`Meta encontró ${r.conversation_candidates??r.conversations??0} conversaciones · ${r.scanned??0} mensajes revisados · ${r.inserted??0} guardados/actualizados · ${r.duplicates??0} sin cambios${r.truncated_to_recent_20?' · algunas conversaciones exceden los 20 mensajes recuperables':''}`);
   await load(null,{quiet:true});
   if(selected)await load(selected,{quiet:true});
  }catch(e){
   try{
    const msg=String(e?.message||'');
    setHistoryStatus(msg.includes('history_internal_credential')?'El historial falló al validar la credencial':msg.includes('history_internal_list')?'El historial falló al preparar/listar conversaciones':msg.includes('history_internal_detail')?'El historial falló al abrir una conversación':msg.includes('history_internal_message')?'El historial falló al procesar un mensaje':msg.includes('history_internal_persist')?'El historial falló al guardar los mensajes':msg.includes('history_list')?'Meta no permitió listar conversaciones':msg.includes('history_detail')?'Meta listó conversaciones pero no permitió leer sus mensajes':msg.includes('history_message')?'Meta permitió listar el hilo pero no leer uno de sus mensajes':msg.includes('history_not_durable')?'Meta devolvió historial pero no pudo guardarse de forma durable':msg.includes('history_unknown_stage')?'El historial falló en una etapa interna no clasificada':'No fue posible recuperar el historial reciente');
   }catch{setHistoryStatus('No fue posible recuperar el historial reciente');}
  }
  finally{setSyncing(false);}
 }

 async function saveContact(){
  if(!selected||contactBusy)return;
  setContactBusy(true);setStatus('');
  try{
   const r=await request('contact-set',{body:{thread:selected,phone:phoneDraft,email:emailDraft}});
   setPhoneDraft(r.phone||'');setEmailDraft(r.email||'');setStatus('Datos de contacto guardados');
  }catch{setStatus('No fue posible guardar teléfono/correo');}
  finally{setContactBusy(false);}
 }

 async function saveAlias(){
  if(!selected||aliasBusy)return;
  setAliasBusy(true);setStatus('');
  try{
   const r=await request('alias-set',{body:{thread:selected,alias:aliasDraft}});
   setAliasDraft(r.alias||'');
   setThreads(list=>list.map(t=>t.thread_ref===selected?{...t,alias:r.alias||null}:t));
   setMobileAliasEditing(false);
   setStatus(r.alias?'Nombre guardado':'Nombre eliminado');
  }catch{setStatus('No fue posible guardar el nombre');}
  finally{setAliasBusy(false);}
 }

 const eligibleInbound=[...rows].reverse().find(r=>r.direction==='customer_inbound'&&!r.deleted&&Date.now()-Date.parse(r.occurred_at)>=0&&Date.now()-Date.parse(r.occurred_at)<23*3600000)||null;
 const replyAnchor=input||eligibleInbound?.input||null;


 async function startRecording(){
  if(lock.current||recording||pendingMedia||!enabled||!replyAnchor||uncertainLocked)return;
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setStatus('Este navegador no permite grabar audio');return;}
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const mime=MediaRecorder.isTypeSupported?.('audio/mp4;codecs=mp4a.40.2')?'audio/mp4;codecs=mp4a.40.2':MediaRecorder.isTypeSupported?.('audio/mp4')?'audio/mp4':'';
   if(!mime){stream.getTracks().forEach(t=>t.stop());setStatus('Este navegador no puede grabar audio compatible');return;}
   const recorder=new MediaRecorder(stream,{mimeType:mime});
   recordStreamRef.current=stream;recordChunksRef.current=[];recorderRef.current=recorder;
   recorder.ondataavailable=e=>{if(e.data?.size)recordChunksRef.current.push(e.data);};
   recorder.onstop=()=>{
    const blob=new Blob(recordChunksRef.current,{type:'audio/mp4'});
    recordChunksRef.current=[];recordStreamRef.current?.getTracks().forEach(t=>t.stop());recordStreamRef.current=null;
    if(recordTimerRef.current){clearInterval(recordTimerRef.current);recordTimerRef.current=null;}
    setRecording(false);
    if(blob.size>0){
     if(pendingMedia?.url)URL.revokeObjectURL(pendingMedia.url);
     setPendingMedia({file:new File([blob],'nota-voz.m4a',{type:'audio/mp4'}),url:URL.createObjectURL(blob),kind:'audio'});
    }
   };
   recorder.start(250);setRecordSeconds(0);setRecording(true);setStatus('Grabando nota de voz…');
   recordTimerRef.current=setInterval(()=>setRecordSeconds(s=>s+1),1000);
  }catch{setStatus('No fue posible acceder al micrófono');}
 }

 function stopRecording(){
  const recorder=recorderRef.current;
  if(recorder&&recorder.state==='recording')recorder.stop();
 }

 function cancelRecording(){
  const recorder=recorderRef.current;
  if(recorder&&recorder.state==='recording'){
   recorder.onstop=()=>{recordStreamRef.current?.getTracks().forEach(t=>t.stop());recordStreamRef.current=null;recordChunksRef.current=[];};
   recorder.stop();
  }else recordStreamRef.current?.getTracks().forEach(t=>t.stop());
  if(recordTimerRef.current){clearInterval(recordTimerRef.current);recordTimerRef.current=null;}
  setRecording(false);setRecordSeconds(0);setStatus('');
 }

 function chooseMediaFile(file){
  if(!file||lock.current||!enabled||!replyAnchor||uncertainLocked)return;
  const isVideo=['video/mp4','video/quicktime'].includes(file.type),isAudio=file.type==='audio/mp4';
  if(!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mp4'].includes(file.type)){setStatus('Formato no compatible');if(mediaInputRef.current)mediaInputRef.current.value='';return;}
  const limit=(isVideo||isAudio)?26214400:8388608;
  if(file.size<=0||file.size>limit){setStatus(isVideo?'Instagram permite videos de hasta 25 MB':'Instagram permite imágenes de hasta 8 MB');if(mediaInputRef.current)mediaInputRef.current.value='';return;}
  if(pendingMedia?.url)URL.revokeObjectURL(pendingMedia.url);
  setPendingMedia({file,url:URL.createObjectURL(file)});
  setStatus('');
 }

 function cancelPendingMedia(){
  if(pendingMedia?.url)URL.revokeObjectURL(pendingMedia.url);
  setPendingMedia(null);
  if(mediaInputRef.current)mediaInputRef.current.value='';
 }

 async function sendMediaFile(){
  const file=pendingMedia?.file;
  if(!file||lock.current||!enabled||!replyAnchor||uncertainLocked)return;
  const isVideo=['video/mp4','video/quicktime'].includes(file.type),isAudio=file.type==='audio/mp4';
  if(!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','audio/mp4'].includes(file.type)){setStatus('Formato no compatible');return;}
  const limit=(isVideo||isAudio)?26214400:8388608;
  if(file.size<=0||file.size>limit){setStatus(isAudio?'El audio excede el límite permitido':isVideo?'Instagram permite videos de hasta 25 MB':'Instagram permite imágenes de hasta 8 MB');return;}
  const {data}=await supabase.auth.getSession();
  if(!data?.session?.user?.id){setStatus('Sesión requerida');return;}
  lock.current=true;setBusy(true);setStatus(isAudio?'Subiendo audio…':isVideo?'Subiendo video…':'Subiendo foto…');
  const ext=isAudio?'m4a':file.type==='video/quicktime'?'mov':isVideo?'mp4':file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  const path=`${data.session.user.id}/${crypto.randomUUID()}.${ext}`;
  try{
   const upload=await supabase.storage.from('instagram-business-outbound').upload(path,file,{contentType:file.type,upsert:false});
   if(upload.error)throw Error('upload_failed');
   setStatus(isAudio?'Enviando audio…':isVideo?'Enviando video…':'Enviando foto…');
   const action=crypto.randomUUID();
   const r=await request('media-reply',{body:{input:replyAnchor,action,path,mime:file.type,size:file.size}});
   if(r.status==='accepted'){
    const nowIso=new Date().toISOString(),previewUrl=pendingMedia?.url;
    setOptimistic(list=>[...list,{id:'local-'+action,kind:isAudio?'audio':isVideo?'video':'image',url:previewUrl,occurred_at:nowIso,sentAt:Date.now(),status:'Enviado'}]);
    setPendingMedia(null);if(mediaInputRef.current)mediaInputRef.current.value='';
    setStatus(isAudio?'Audio enviado':isVideo?'Video enviado':'Foto enviada');setInput(null);setUncertainLocked(false);
    scrollChatBottom('smooth');
    void load(null,{quiet:true});
   }
   else if(r.status==='uncertain'){setUncertainLocked(true);setStatus('Resultado incierto · revisa Instagram antes de enviar otro mensaje');}
   else{const validation=r?.diagnostic?.validation;setStatus(validation?`${r.status} · ${validation}`:r.status);}
  }catch{setStatus('No fue posible enviar la foto');}
  finally{lock.current=false;setBusy(false);}
 }

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
    const sentText=text.trim(),nowIso=new Date().toISOString();
    setOptimistic(list=>[...list,{id:'local-'+action,kind:'text',text:sentText,occurred_at:nowIso,sentAt:Date.now(),status:'Enviado'}]);
    setStatus('Enviado');setText('');setInput(null);setUncertainLocked(false);
    scrollChatBottom('smooth');
    void load(null,{quiet:true});
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
    <div><h2>Inbox {notifications.unread_count>0&&<b className="notificationCount">{notifications.unread_count}</b>}</h2><span>Instagram</span></div>
    <div className="headerActions"><button className="historyButton" disabled={busy||syncing} onClick={syncHistory}>{syncing?'Recuperando…':'7 días'}</button><button className="iconButton" title="Actualizar" disabled={busy||syncing} onClick={()=>load()}>↻</button></div>
   </div>
   {historyStatus&&<div className="historyStatus" role="status">{historyStatus}</div>}
   <div className="channelTabs">
    <button className="channel active"><span className="igDot">◎</span> Instagram</button>
    <button className="channel" disabled><span>f</span> Facebook <small>próximamente</small></button>
   </div>
   <div className="searchWrap"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar conversaciones"/></div>
   <div className="threadFilters">
    <button className={threadFilter==='all'?'active':''} onClick={()=>setThreadFilter('all')}>Todos</button>
    <button className={threadFilter==='unassigned'?'active':''} onClick={()=>setThreadFilter('unassigned')}>Sin asignar</button>
    <button className={threadFilter==='puebla'?'active':''} onClick={()=>setThreadFilter('puebla')}>Puebla</button>
    <button className={threadFilter==='veracruz'?'active':''} onClick={()=>setThreadFilter('veracruz')}>Veracruz</button>
   </div>
   <div className="threadList" aria-label="Conversaciones Instagram">
    {busy&&!threads.length&&<div className="emptyList">Cargando conversaciones…</div>}
    {!busy&&!threads.length&&!status&&<div className="emptyList">No hay conversaciones disponibles.</div>}
    {filtered.map((t,i)=>{
     const active=t.thread_ref===selected;
     const n=threads.indexOf(t)+1;
     return <button key={t.thread_ref} className={`threadCard ${active?'selected':''} ${unreadThreads.has(t.thread_ref)?'unread':''}`} onClick={()=>load(t.thread_ref)} disabled={busy}>
      {t.profile_pic?<img src={t.profile_pic} alt="" className="threadAvatarPic"/>:<div className="avatar">IG</div>}
      <div className="threadCopy">
       <div className="threadTop"><strong>{t.alias||(t.profile_username?`@${t.profile_username}`:t.profile_name)||`Conversación Instagram ${n}`}</strong><div className="threadTimeWrap">{unreadThreads.has(t.thread_ref)&&<em>Nuevo</em>}<time>{clock(t.last_activity)}</time></div></div>
       <p>{t.department==='sales'?'Ventas':t.department==='legal'?'Jurídico':t.department==='administration'?'Administración':'Por clasificar'} · {t.plaza_name||'Sin plaza'} · {t.assigned_advisor_name||'Sin asignar'}</p>
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
     <div className="contactTitle"><div className="avatar large">IG</div><div><strong>{threads.find(t=>t.thread_ref===selected)?.alias||(profile?.username?`@${profile.username}`:profile?.name)||`Conversación Instagram ${selectedIndex+1}`}</strong><span>{profile?.username&&profile?.name?`${profile.name} · `:''}Instagram · Meta directo{assignment?.advisor_name?` · Asignado: ${assignment.advisor_name}`:''}</span></div></div>
     <button type="button" className="mobileAliasButton" onClick={()=>setMobileAliasEditing(true)}>Ficha</button>
     <div className={`senderBadge ${enabled?'on':'off'}`}>{enabled?'Envío habilitado':'Sender OFF'}</div>
    </header>
    {mobileAliasEditing&&<div className="contactSheetBackdrop" onClick={()=>setMobileAliasEditing(false)}>
      <section className="contactSheet" onClick={e=>e.stopPropagation()}>
       <div className="contactSheetHead"><div><strong>Ficha de contacto</strong><span>Instagram · uso interno</span></div><button type="button" onClick={()=>setMobileAliasEditing(false)}>×</button></div>
       <label>Nombre interno</label>
       <input value={aliasDraft} onChange={e=>setAliasDraft(e.target.value)} maxLength={80} placeholder="Ej. Cliente Zavaleta"/>
       <button type="button" className="sheetPrimary" disabled={aliasBusy} onClick={saveAlias}>{aliasBusy?'Guardando…':'Guardar nombre'}</button>
       <label>Teléfono</label>
       <input value={phoneDraft} onChange={e=>setPhoneDraft(e.target.value)} maxLength={32} inputMode="tel" placeholder="Ej. 222 123 4567"/>
       <label>Correo</label>
       <input value={emailDraft} onChange={e=>setEmailDraft(e.target.value)} maxLength={254} inputMode="email" placeholder="cliente@correo.com"/>
       <button type="button" className="sheetPrimary" disabled={contactBusy} onClick={saveContact}>{contactBusy?'Guardando…':'Guardar contacto'}</button>
       <label>Asignado a</label>
       <select value={assignmentDraft} onChange={e=>setAssignmentDraft(e.target.value)}>
        <option value="">Sin asignar</option>
        {assignmentOptions.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
       </select>
       <button type="button" className="sheetPrimary" disabled={assignmentBusy||!assignmentDraft} onClick={saveAssignment}>{assignmentBusy?'Guardando…':assignment?.advisor_id?'Reasignar':'Asignar'}</button>
       {assignment?.advisor_name&&<small>Actual: {assignment.advisor_name}{assignment.source==='crm'?' · Cliente ya vinculado en CRM':''}.</small>}
       <small>Estos datos sólo viven en Inmoadmin. Si el contacto ya está vinculado a un cliente CRM, una reasignación también cambia su asesor responsable.</small>
      </section>
    </div>}
    <div className="messages" ref={chatRef}>
     {rows.map(r=>{
      const inbound=r.direction==='customer_inbound';
      return <div key={r.input} className={`messageRow ${inbound?'incoming':'outgoing'}`}>
       <article className="bubble">
        {r.attachments?.map(a=>['image','audio','video'].includes(a.type)?<Media key={a.index} thread={selected} input={r.input} index={a.index} type={a.type} onOpen={setLightbox} onLoaded={()=>scrollChatBottom('auto')}/>:<div key={a.index} className="mediaPlaceholder">Adjunto no soportado</div>)}
        {r.text&&<LinkifiedText text={r.text}/>}
        <div className="bubbleMeta"><time>{messageStamp(r.occurred_at)}</time>{r.status&&<span> · {r.status}</span>}</div>
       </article>
       {inbound&&!r.deleted&&<button className="replyChip" disabled={busy||uncertainLocked} onClick={()=>setInput(r.input)}>{input===r.input?'✓ Respondiendo aquí':'Responder aquí'}</button>}
      </div>;
     })}
     {appointmentRows.map(a=><div key={'appointment-'+a.id} className={`appointmentThreadCard ${a.estado==='cancelada'?'cancelled':''}`}>
      <div className="appointmentThreadIcon">{a.estado==='cancelada'?'✕':'📅'}</div>
      <div><strong>{a.estado==='cancelada'?'Cita cancelada':'Cita agendada'}</strong><span>{new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'}).format(new Date(a.fecha_hora))}</span>
      <small>{[a.property_title,a.advisor_name].filter(Boolean).join(' · ')}</small>{a.notas&&<small>{a.notas}</small>}
      {a.estado!=='cancelada'&&<button type="button" className="cancelAppointmentBtn" disabled={appointmentCancelBusy===a.id} onClick={()=>cancelAppointment(a.id)}>{appointmentCancelBusy===a.id?'Cancelando…':'Cancelar cita'}</button>}</div>
     </div>)}
     {optimistic.map(o=><div key={o.id} className="messageRow outgoing optimisticMessage">
      <article className="bubble">
       {o.kind==='image'&&o.url&&<button type="button" onClick={()=>setLightbox(o.url)} style={{border:0,background:'transparent',padding:0,cursor:'zoom-in',maxWidth:'100%',display:'block'}}>
        <img src={o.url} alt="Foto enviada" style={{display:'block',width:'auto',height:'auto',maxWidth:'160px',maxHeight:'140px',objectFit:'contain',background:'#f3f4f6',borderRadius:'12px',marginBottom:'7px'}}/>
       </button>}
       {o.kind==='video'&&o.url&&<video controls preload="metadata" src={o.url} style={{display:'block',width:'260px',maxWidth:'100%',maxHeight:'220px',borderRadius:'12px',background:'#000'}}/>}
       {o.kind==='audio'&&o.url&&<audio controls preload="metadata" src={o.url} style={{display:'block',width:'260px',maxWidth:'100%'}}/>}
       {o.kind==='text'&&<LinkifiedText text={o.text}/>}
       <div className="bubbleMeta"><time>{messageStamp(o.occurred_at)}</time><span> · ✓ Enviado</span></div>
      </article>
     </div>)}
     <div ref={bottomRef} className="chatBottomSentinel" aria-hidden="true"/>
    </div>
    <form className="composer" onSubmit={send}>
     {pendingMedia&&<div className="mediaPreview">
      <div className="mediaPreviewImage">{pendingMedia.file.type==='audio/mp4'?<audio src={pendingMedia.url} controls preload="metadata"/>:['video/mp4','video/quicktime'].includes(pendingMedia.file.type)?<video src={pendingMedia.url} controls preload="metadata"/>:<img src={pendingMedia.url} alt="Vista previa de la foto por enviar"/>}</div>
      <div className="mediaPreviewActions">
       <button type="button" className="previewCancel" onClick={cancelPendingMedia} disabled={busy}>Cancelar</button>
       <button type="button" className="previewSend" onClick={sendMediaFile} disabled={busy||!enabled||!replyAnchor||uncertainLocked}>{busy?'Enviando…':pendingMedia.file.type==='audio/mp4'?'Enviar audio':['video/mp4','video/quicktime'].includes(pendingMedia.file.type)?'Enviar video':'Enviar foto'}</button>
      </div>
     </div>}
     {replyTarget&&<div className="replyContext"><span>Respondiendo al mensaje de las {clock(replyTarget.occurred_at)}</span><button type="button" onClick={()=>setInput(null)}>×</button></div>}
     <div className="composerRow">
      <button type="button" className="appointmentButton" title="Agendar cita" disabled={busy||recording||!!pendingMedia||!enabled||!replyAnchor||uncertainLocked||appointmentBusy} onClick={openAppointment}>📅</button>
      <button type="button" className="propertyButton" title="Enviar propiedad" disabled={busy||recording||!!pendingMedia||!enabled||!replyAnchor||uncertainLocked} onClick={openPropertyPicker}>🏠</button>
      <input ref={mediaInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mov" hidden onChange={e=>chooseMediaFile(e.target.files?.[0])}/>
      <button type="button" className="attachButton" title="Adjuntar foto o video" disabled={busy||recording||!enabled||!replyAnchor||uncertainLocked} onClick={()=>mediaInputRef.current?.click()}>＋</button>
      {recording?<div className="recordingBar"><span>● {recordSeconds}s</span><button type="button" onClick={cancelRecording}>Cancelar</button><button type="button" onClick={stopRecording}>Detener</button></div>:<button type="button" className="micButton" title="Grabar nota de voz" disabled={busy||!!pendingMedia||!enabled||!replyAnchor||uncertainLocked} onClick={startRecording}>🎤</button>}
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
    <div className="detailBlock"><label>Contacto</label><div className="contactEditor"><input value={phoneDraft} onChange={e=>setPhoneDraft(e.target.value)} maxLength={32} placeholder="Teléfono"/><input value={emailDraft} onChange={e=>setEmailDraft(e.target.value)} maxLength={254} placeholder="Correo"/><button disabled={contactBusy} onClick={saveContact}>{contactBusy?'…':'Guardar'}</button></div></div>
    <div className="detailBlock"><label>Asignado a</label><div className="assignmentEditor"><select value={assignmentDraft} onChange={e=>setAssignmentDraft(e.target.value)}><option value="">Sin asignar</option>{assignmentOptions.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button disabled={assignmentBusy||!assignmentDraft} onClick={saveAssignment}>{assignmentBusy?'…':assignment?.advisor_id?'Reasignar':'Asignar'}</button></div>{assignment?.advisor_name&&<small>Actual: {assignment.advisor_name}{assignment.source==='crm'?' · CRM':''}</small>}</div>
    <div className="detailBlock"><label>Canal</label><p>Instagram Direct</p></div>
    <div className="detailBlock"><label>Estado</label><p>{enabled?'Atención manual habilitada':'Lectura disponible · sender OFF'}</p></div>
    <div className="detailBlock"><label>Seguridad</label><p>Contenido y destinatario cifrados. Sin reintentos automáticos.</p></div>
    <div className="detailBlock muted"><p>Facebook/Messenger se incorporará aquí como segundo canal, sin crear otra bandeja.</p></div>
   </div>:<div className="detailsBody muted">Selecciona una conversación para ver su contexto.</div>}
  </aside>

  {appointmentOpen&&<div className="appointmentBackdrop" onClick={()=>!appointmentBusy&&setAppointmentOpen(false)}>
   <section className="appointmentSheet" onClick={e=>e.stopPropagation()}>
    <div className="appointmentHead"><div><strong>Agendar cita</strong><span>Se guardará en Clientes, Citas y KPIs</span></div><button type="button" onClick={()=>setAppointmentOpen(false)} disabled={appointmentBusy}>×</button></div>
    <label>Cliente</label><input value={appointmentForm.name} onChange={e=>setAppointmentForm(v=>({...v,name:e.target.value}))} maxLength={120}/>
    <div className="appointmentTwo"><div><label>Teléfono</label><input value={appointmentForm.phone} onChange={e=>setAppointmentForm(v=>({...v,phone:e.target.value}))} inputMode="tel" maxLength={32}/></div><div><label>Correo</label><input value={appointmentForm.email} onChange={e=>setAppointmentForm(v=>({...v,email:e.target.value}))} inputMode="email" maxLength={254}/></div></div>
    {clientMatchBusy&&<div className="clientMatchHint">Buscando coincidencias en Clientes…</div>}
    {!clientMatchBusy&&clientMatches.length>0&&<div className="clientMatchBox">
      <strong>Este contacto ya podría existir</strong>
      {clientMatches.map(c=><button type="button" key={c.id} className={selectedClientMatch?.id===c.id?'clientMatchSelected':''} onClick={()=>useClientMatch(c)}>
       <span>{c.nombre}</span><small>{[c.telefono,c.correo,c.asesor_nombre?('Asesor: '+c.asesor_nombre):null].filter(Boolean).join(' · ')}</small>
      </button>)}
      {selectedClientMatch&&<small className="clientMatchUsing">✓ Se usará este cliente existente; no se creará duplicado.</small>}
    </div>}
    <label>Propiedad</label><select value={appointmentForm.property_id} onChange={e=>setAppointmentForm(v=>({...v,property_id:e.target.value}))}><option value="">Sin propiedad específica</option>{propertyRows.map(p=><option key={p.id} value={p.id}>{p.public_id} · {short(p.titulo,55)}</option>)}</select>
    <label>Asesor</label><select value={appointmentForm.advisor_id} onChange={e=>setAppointmentForm(v=>({...v,advisor_id:e.target.value}))}>{appointmentAdvisors.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
    <label>Fecha y hora</label><input type="datetime-local" value={appointmentForm.fecha_local} onChange={e=>setAppointmentForm(v=>({...v,fecha_local:e.target.value}))}/>
    <label>Notas</label><textarea value={appointmentForm.notas} onChange={e=>setAppointmentForm(v=>({...v,notas:e.target.value}))} maxLength={500} placeholder="Ej. Cliente confirma acceso, llevar llaves…"/>
    <div className="appointmentActions"><button type="button" onClick={()=>setAppointmentOpen(false)} disabled={appointmentBusy}>Cancelar</button><button type="button" className="appointmentPrimary" onClick={createAppointment} disabled={appointmentBusy}>{appointmentBusy?'Guardando…':'Agendar cita'}</button></div>
   </section>
  </div>}

  {propertyPicker&&<div className="propertyPickerBackdrop" onClick={()=>!propertyBusy&&setPropertyPicker(false)}>
   <section className="propertyPickerSheet" onClick={e=>e.stopPropagation()}>
    <div className="propertyPickerHead"><div><strong>Enviar propiedad</strong><span>Sólo propiedades publicadas</span></div><button type="button" onClick={()=>setPropertyPicker(false)} disabled={propertyBusy}>×</button></div>
    <input className="propertySearchInput" value={propertySearch} onChange={e=>setPropertySearch(e.target.value)} placeholder="Buscar por clave, colonia, tipo o título…"/>
    <div className="propertySelectionBar"><strong>{propertyChoices.length}/5 seleccionadas</strong>{propertyChoices.length>0&&<button type="button" onClick={()=>setPropertyChoices([])}>Limpiar</button>}</div>
    <div className="propertyResults">
     {propertyBusy&&<div className="propertyEmpty">Cargando propiedades…</div>}
     {!propertyBusy&&!filteredProperties.length&&<div className="propertyEmpty">No encontré propiedades publicadas.</div>}
     {filteredProperties.map(p=>{
      const checked=propertyChoices.some(x=>x.id===p.id);
      return <button type="button" className={`propertyCard ${checked?'propertySelected':''}`} key={p.id} onClick={()=>toggleProperty(p)}>
       <span className="propertyCheck">{checked?'✓':''}</span>
       {p.foto?<img src={p.foto} alt=""/>:<div className="propertyNoPhoto">🏠</div>}
       <div><strong>{p.titulo}</strong><span>{money(p.precio)} · {p.operacion==='sale'?'Venta':'Renta'}</span><small>{[p.colonia,p.ciudad].filter(Boolean).join(', ')} · {p.public_id}</small></div>
      </button>;
     })}
    </div>
    {propertyChoices.length>0&&<div className="propertyMultiConfirm">
     <div className="propertyMessagePreview"><LinkifiedText text={propertyMessage(propertyChoices)}/></div>
     <div className="propertyConfirmActions"><button type="button" onClick={()=>setPropertyPicker(false)} disabled={propertyBusy}>Cancelar</button><button type="button" className="propertySend" onClick={sendProperty} disabled={propertyBusy}>{propertyBusy?'Enviando…':`Enviar ${propertyChoices.length} ${propertyChoices.length===1?'propiedad':'propiedades'}`}</button></div>
    </div>}
   </section>
  </div>}

  {lightbox&&<div className="lightbox" role="dialog" aria-modal="true" onClick={()=>setLightbox(null)}><button type="button" className="lightboxClose" onClick={()=>setLightbox(null)}>×</button><img src={lightbox} alt="Imagen de Instagram ampliada" onClick={e=>e.stopPropagation()}/></div>}
  {status&&status.includes('no disponible')&&<div className="globalError" role="alert">{status}</div>}

  <style jsx>{`
   .inboxShell{height:calc(100vh - 62px);min-height:620px;background:#fff;display:grid;grid-template-columns:320px minmax(420px,1fr) 280px;border-top:1px solid #e5e7eb;color:#1f2937}
   .conversationPane,.detailsPane{min-width:0;background:#fff}.conversationPane{min-height:0;height:100%;overflow:hidden;border-right:1px solid #e5e7eb;display:flex;flex-direction:column}.detailsPane{border-left:1px solid #e5e7eb}
   .paneHeader,.chatHeader,.detailsHeader{height:68px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb;box-sizing:border-box}
   .paneHeader h2{margin:0;font-size:22px}.paneHeader span,.contactTitle span{display:block;color:#6b7280;font-size:12px;margin-top:2px}
   .headerActions{display:flex;gap:7px;align-items:center}.historyButton{height:34px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;padding:0 10px;font-size:11px;font-weight:800;color:#4b5563;cursor:pointer}.iconButton{width:34px;height:34px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;font-size:18px;cursor:pointer}
   .channelTabs{display:flex;gap:6px;padding:12px 14px 6px}.channel{border:0;background:#f3f4f6;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;color:#6b7280}.channel.active{background:#fce8ed;color:#b91c3c}.channel small{font-size:9px;font-weight:600}.igDot{font-size:16px}
   .searchWrap{margin:8px 14px 8px;background:#f3f4f6;border-radius:10px;padding:9px 12px;display:flex;gap:8px;align-items:center}.searchWrap input{width:100%;border:0;outline:0;background:transparent;font-size:13px}.threadFilters{display:flex;gap:6px;padding:0 14px 10px;overflow-x:auto}.threadFilters button{border:0;background:#f3f4f6;color:#6b7280;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:800;white-space:nowrap}.threadFilters button.active{background:#fce8ed;color:#b91c3c}.notificationCount{display:inline-flex;min-width:19px;height:19px;padding:0 5px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:999px;background:#b91c3c;color:#fff;font-size:10px;vertical-align:2px}.threadCard.unread{background:#fff7f8}.threadTimeWrap{display:flex;align-items:center;gap:6px}.threadTimeWrap em{font-style:normal;font-size:9px;font-weight:900;color:#b91c3c;background:#fce8ed;border-radius:999px;padding:3px 6px}
   .threadList{min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;flex:1}.threadCard{width:100%;border:0;border-top:1px solid #f3f4f6;background:#fff;padding:13px 14px;display:flex;gap:11px;text-align:left;cursor:pointer}.threadCard:hover,.threadCard.selected{background:#f9fafb}.threadCard.selected{box-shadow:inset 3px 0 #b91c3c}
   .profilePic{width:64px;height:64px;border-radius:50%;object-fit:cover}.threadAvatarPic{width:38px;height:38px;border-radius:50%;object-fit:cover;flex:none}.avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#ec4899,#f59e0b);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:none}.avatar.large{width:42px;height:42px}.avatar.xlarge{width:64px;height:64px;font-size:16px}
   .threadCopy{min-width:0;flex:1}.threadTop{display:flex;justify-content:space-between;gap:8px;align-items:center}.threadTop strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.threadTop time{font-size:10px;color:#9ca3af}.threadCopy p{margin:4px 0 2px;color:#6b7280;font-size:12px}.threadCopy small{color:#9ca3af;font-size:10px}.emptyList{padding:28px 18px;color:#9ca3af;font-size:13px;text-align:center}
   .chatPane{min-width:0;min-height:0;height:100%;overflow:hidden;background:#f7f8fa;display:flex;flex-direction:column}.chatHeader{background:#fff}.backButton{display:none;border:0;background:transparent;font-size:28px;line-height:1;color:#b91c3c;padding:0 4px;cursor:pointer}.mobileAliasButton{display:none;border:0;background:transparent;color:#b91c3c;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}.contactSheetBackdrop{display:none}.contactTitle{display:flex;align-items:center;gap:10px}.contactTitle strong{font-size:14px}.senderBadge{font-size:11px;font-weight:800;border-radius:999px;padding:6px 9px}.senderBadge.on{background:#dcfce7;color:#166534}.senderBadge.off{background:#f3f4f6;color:#6b7280}
   .messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:24px 28px;display:flex;flex-direction:column;gap:14px}.messageRow{display:flex;flex-direction:column;max-width:72%}.messageRow.incoming{align-self:flex-start;align-items:flex-start}.messageRow.outgoing{align-self:flex-end;align-items:flex-end}
   .bubble{border-radius:18px;padding:10px 13px;box-shadow:0 1px 2px rgba(0,0,0,.06);max-width:100%;overflow:hidden}.incoming .bubble{background:#fff;border-bottom-left-radius:5px}.outgoing .bubble{background:#fce8ed;border-bottom-right-radius:5px}.bubble p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.45}.bubble a{color:#2563eb;text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}.bubbleMeta{margin-top:5px;color:#9ca3af;font-size:9px;text-align:right}.optimisticMessage .bubble{box-shadow:0 1px 2px rgba(0,0,0,.06),inset 0 0 0 1px rgba(185,28,60,.06)}.replyChip{margin-top:5px;border:0;background:transparent;color:#b91c3c;font-size:11px;font-weight:700;cursor:pointer;padding:3px 5px}
   .mediaButton{border:0;background:transparent;padding:0;cursor:zoom-in;max-width:100%}.inboxMedia{display:block;width:auto;height:auto;max-width:220px;max-height:170px;object-fit:contain;background:#f3f4f6;border-radius:12px;margin-bottom:7px}.chatBottomSentinel{height:1px;flex:none}.mediaPlaceholder{background:#f3f4f6;color:#9ca3af;padding:20px;border-radius:10px;font-size:12px}
   .composer{background:#fff;border-top:1px solid #e5e7eb;padding:12px 18px}.mediaPreview{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;margin-bottom:10px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb}.mediaPreviewImage{width:96px;height:96px;border-radius:12px;overflow:hidden;background:#eef2f7;display:flex;align-items:center;justify-content:center;flex:none}.mediaPreviewImage img,.mediaPreviewImage video{width:100%;height:100%;object-fit:cover}.mediaPreviewImage audio{width:100%;max-width:260px}.mediaPreviewActions{display:flex;gap:8px;margin-left:auto}.previewCancel,.previewSend{height:40px;border-radius:10px;padding:0 14px;font-weight:800;cursor:pointer}.previewCancel{border:1px solid #d1d5db;background:#fff;color:#4b5563}.previewSend{border:0;background:#b91c3c;color:#fff}.previewCancel:disabled,.previewSend:disabled{opacity:.55;cursor:not-allowed}.replyContext{display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border-left:3px solid #b91c3c;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#6b7280}.replyContext button{border:0;background:transparent;font-size:18px;color:#6b7280;cursor:pointer}
   .composerRow{display:flex;gap:10px;align-items:flex-end}.appointmentButton{width:42px;height:42px;flex:none;border:1px solid #d1d5db;border-radius:10px;background:#fff;font-size:18px;cursor:pointer}.appointmentButton:disabled{opacity:.45;cursor:not-allowed}.propertyButton{width:42px;height:42px;flex:none;border:1px solid #d1d5db;border-radius:10px;background:#fff;font-size:19px;cursor:pointer}.propertyButton:disabled{opacity:.45;cursor:not-allowed}.micButton{width:42px;height:42px;flex:none;border:1px solid #d1d5db;border-radius:10px;background:#fff;font-size:20px;cursor:pointer}.micButton:disabled{opacity:.45;cursor:not-allowed}.recordingBar{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 8px;border:1px solid #fecaca;background:#fff1f2;border-radius:10px;color:#b91c3c;font-size:12px;font-weight:800}.recordingBar button{border:0;border-radius:8px;padding:7px 9px;background:#fff;color:#b91c3c;font-weight:800}.attachButton{width:42px;height:42px;flex:none;border:1px solid #d1d5db;border-radius:10px;background:#fff;color:#b91c3c;font-size:24px;line-height:1;font-weight:700;cursor:pointer}.attachButton:disabled{color:#cbd5e1;background:#f9fafb;cursor:not-allowed}.composer textarea{flex:1;resize:none;min-height:58px;max-height:130px;border:1px solid #d1d5db;border-radius:14px;padding:11px 12px;font:inherit;outline:0}.composer textarea:focus{border-color:#b91c3c}.sendButton{height:42px;border:0;border-radius:10px;padding:0 18px;background:#b91c3c;color:#fff;font-weight:800;cursor:pointer}.sendButton:disabled{background:#e5e7eb;color:#9ca3af;cursor:not-allowed}.composerFoot{display:flex;justify-content:space-between;color:#9ca3af;font-size:10px;margin-top:6px}
   .detailsHeader h3{margin:0;font-size:15px}.detailsBody{padding:20px}.profileCard{text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;padding-bottom:20px;border-bottom:1px solid #e5e7eb}.profileCard strong{margin-top:5px}.profileCard span{font-size:11px;color:#9ca3af}.detailBlock{padding:15px 0;border-bottom:1px solid #f3f4f6}.detailBlock label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;font-weight:800}.detailBlock p{font-size:12px;line-height:1.45;margin:5px 0 0}.detailBlock small{display:block;color:#9ca3af;font-size:10px;margin-top:6px}.aliasEditor{display:flex;gap:6px;margin-top:7px}.aliasEditor input{min-width:0;flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:12px}.aliasEditor button{border:0;border-radius:8px;background:#b91c3c;color:#fff;padding:0 10px;font-size:11px;font-weight:800}.contactEditor{display:grid;gap:7px;margin-top:7px}.contactEditor input{border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:12px}.contactEditor button{border:0;border-radius:8px;background:#b91c3c;color:#fff;padding:8px 10px;font-size:11px;font-weight:800}.assignmentEditor{display:flex;gap:6px;margin-top:7px}.assignmentEditor select{min-width:0;flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:12px;background:#fff}.assignmentEditor button{border:0;border-radius:8px;background:#b91c3c;color:#fff;padding:0 10px;font-size:11px;font-weight:800}.appointmentThreadCard{align-self:center;display:flex;gap:10px;align-items:flex-start;width:min(92%,520px);box-sizing:border-box;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;color:#7c2d12}.appointmentThreadIcon{font-size:20px}.appointmentThreadCard>div:last-child{display:flex;flex-direction:column;gap:2px}.appointmentThreadCard strong{font-size:12px}.appointmentThreadCard span{font-size:11px;font-weight:700}.appointmentThreadCard small{font-size:10px;color:#9a3412}.appointmentBackdrop{position:fixed;inset:0;z-index:980;background:rgba(17,24,39,.48);display:flex;align-items:flex-end;justify-content:center}.appointmentSheet{width:min(100%,560px);max-height:90vh;overflow-y:auto;background:#fff;border-radius:20px 20px 0 0;padding:18px;box-sizing:border-box;display:grid;gap:9px;box-shadow:0 -10px 30px rgba(0,0,0,.16)}.appointmentHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}.appointmentHead strong{font-size:18px}.appointmentHead span{display:block;color:#9ca3af;font-size:11px;margin-top:2px}.appointmentHead button{border:0;background:#f3f4f6;width:34px;height:34px;border-radius:50%;font-size:22px}.appointmentSheet label{font-size:11px;font-weight:800;color:#6b7280}.appointmentSheet input,.appointmentSheet select,.appointmentSheet textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:11px;padding:11px 12px;font-size:15px;background:#fff}.appointmentSheet textarea{min-height:76px;resize:vertical}.appointmentTwo{display:grid;grid-template-columns:1fr 1fr;gap:8px}.appointmentTwo>div{display:grid;gap:6px}.clientMatchHint{font-size:11px;color:#6b7280;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:9px}.clientMatchBox{display:grid;gap:7px;background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:10px}.clientMatchBox>strong{font-size:12px;color:#92400e}.clientMatchBox button{display:grid;text-align:left;gap:2px;border:1px solid #fde68a;background:#fff;border-radius:9px;padding:9px;cursor:pointer}.clientMatchBox button.clientMatchSelected{border-color:#b45309;background:#fff7ed}.clientMatchBox button span{font-size:12px;font-weight:800}.clientMatchBox button small{font-size:10px;color:#78716c}.clientMatchUsing{font-size:10px;color:#166534;font-weight:700}.appointmentActions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}.appointmentActions button{height:40px;border-radius:10px;padding:0 14px;border:1px solid #d1d5db;background:#fff;font-weight:800}.appointmentActions .appointmentPrimary{border:0;background:#b91c3c;color:#fff}.propertyPickerBackdrop{position:fixed;inset:0;z-index:970;background:rgba(17,24,39,.48);display:flex;align-items:flex-end;justify-content:center}.propertyPickerSheet{width:min(100%,620px);max-height:86vh;background:#fff;border-radius:20px 20px 0 0;padding:18px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;box-shadow:0 -10px 30px rgba(0,0,0,.16)}.propertyPickerHead{display:flex;align-items:center;justify-content:space-between}.propertyPickerHead strong{font-size:18px}.propertyPickerHead span{display:block;color:#9ca3af;font-size:11px;margin-top:2px}.propertyPickerHead button{border:0;background:#f3f4f6;width:34px;height:34px;border-radius:50%;font-size:22px}.propertySearchInput{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:11px;padding:11px 12px;font-size:15px}.propertySelectionBar{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#6b7280}.propertySelectionBar button{border:0;background:transparent;color:#b91c3c;font-weight:800}.propertyResults{min-height:0;overflow-y:auto;display:grid;gap:8px}.propertyCard{position:relative;border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:8px;display:flex;gap:10px;text-align:left;cursor:pointer}.propertyCard.propertySelected{border-color:#b91c3c;background:#fff7f8}.propertyCheck{width:22px;height:22px;border:1px solid #d1d5db;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;color:#fff;background:#fff;font-size:12px;font-weight:900}.propertySelected .propertyCheck{background:#b91c3c;border-color:#b91c3c}.propertyCard img,.propertyNoPhoto{width:72px;height:62px;object-fit:cover;border-radius:9px;flex:none;background:#f3f4f6}.propertyNoPhoto{display:flex;align-items:center;justify-content:center;font-size:24px}.propertyCard>div:last-child{min-width:0;display:flex;flex-direction:column;gap:3px}.propertyCard strong{font-size:12px;line-height:1.25}.propertyCard span{font-size:12px;font-weight:800;color:#b91c3c}.propertyCard small{font-size:10px;color:#6b7280}.propertyEmpty{padding:30px;text-align:center;color:#9ca3af}.propertyMultiConfirm{display:grid;gap:8px;border-top:1px solid #e5e7eb;padding-top:10px}.propertyMessagePreview{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:12px;font-size:13px}.propertyMessagePreview :global(p){margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.propertyConfirmActions{display:flex;gap:8px;justify-content:flex-end}.propertyConfirmActions button{height:40px;border-radius:10px;padding:0 14px;border:1px solid #d1d5db;background:#fff;font-weight:800}.propertyConfirmActions .propertySend{border:0;background:#b91c3c;color:#fff}.contactSheetBackdrop{display:none;position:fixed;inset:0;z-index:950;background:rgba(17,24,39,.45);align-items:flex-end;justify-content:center}.contactSheet{width:min(100%,520px);background:#fff;border-radius:20px 20px 0 0;padding:18px 18px 24px;box-shadow:0 -10px 30px rgba(0,0,0,.15);display:grid;gap:9px}.contactSheetHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}.contactSheetHead strong{font-size:18px}.contactSheetHead span{display:block;color:#9ca3af;font-size:11px;margin-top:2px}.contactSheetHead button{border:0;background:#f3f4f6;border-radius:50%;width:34px;height:34px;font-size:22px}.contactSheet label{font-size:11px;font-weight:800;color:#6b7280;margin-top:5px}.contactSheet input,.contactSheet select{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:11px;padding:11px 12px;font-size:15px;background:#fff}.sheetPrimary{border:0;border-radius:10px;background:#b91c3c;color:#fff;padding:11px 12px;font-size:13px;font-weight:800}.contactSheet small{color:#9ca3af;font-size:10px;line-height:1.35}.lightbox{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:24px}.lightbox img{max-width:95vw;max-height:90vh;object-fit:contain;border-radius:10px}.lightboxClose{position:absolute;top:18px;right:18px;width:42px;height:42px;border:0;border-radius:50%;background:#fff;color:#111827;font-size:28px;line-height:1;cursor:pointer}.muted{color:#9ca3af}.emptyChat{margin:auto;text-align:center;color:#6b7280}.emptyIcon{font-size:38px}.emptyChat h3{margin:10px 0 4px}.emptyChat p{margin:0;font-size:13px}.globalError{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fff;padding:10px 15px;border-radius:10px;font-size:12px}
   @media(max-width:1100px){.inboxShell{grid-template-columns:300px 1fr}.detailsPane{display:none}}
   @media(max-width:760px){.inboxShell{height:calc(100dvh - 56px);max-height:calc(100dvh - 56px);overflow:hidden;grid-template-columns:1fr}.conversationPane{display:${selected?'none':'flex'}}.chatPane{display:${selected?'flex':'none'}}.detailsPane{display:none}.messageRow{max-width:88%}.messages{padding:16px}.backButton{display:block}.chatHeader{justify-content:flex-start;gap:6px}.contactTitle{min-width:0;flex:1}.contactTitle>div:last-child{min-width:0}.contactTitle strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mobileAliasButton{display:block}.senderBadge{display:none}.contactSheetBackdrop{display:flex}.appointmentTwo{grid-template-columns:1fr}.inboxMedia{width:auto;height:auto;max-width:160px;max-height:140px;object-fit:contain}.mediaPreview{align-items:stretch}.mediaPreviewImage{width:84px;height:84px}.mediaPreviewActions{flex:1;justify-content:flex-end;align-items:flex-end}.previewCancel,.previewSend{padding:0 12px}}
  .appointmentThreadCard.cancelled{opacity:.62}.cancelAppointmentBtn{margin-top:6px;border:0;background:transparent;color:#b91c3c;font-size:11px;font-weight:800;padding:0;cursor:pointer}.cancelAppointmentBtn:disabled{opacity:.5;cursor:default}\n  `}</style>
 </section>;
}
