import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
export default function CommentReviewPanel(){
 const [platform,setPlatform]=useState('instagram'),[rows,setRows]=useState([]),[selected,setSelected]=useState(null),[drafts,setDrafts]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),pending=useRef(false),editing=useRef(false),acting=useRef(false);
 const [readOnly,setReadOnly]=useState(false);
 const [actionError,setActionError]=useState(''),[actionResult,setActionResult]=useState('');
 const [propertyId,setPropertyId]=useState(''),[propertyConfirmed,setPropertyConfirmed]=useState(false);
 async function request(body){
  const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('Sesión requerida');
  const r=await fetch('/api/operaciones/comment-review?platform='+platform,{method:body?'POST':'GET',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok){const data=await r.json().catch(()=>null);const d=data?.diagnostic;
   const safe=d&&/^[a-z_]{1,32}$/.test(d.stage)&&/^[a-zA-Z0-9_]{1,64}$/.test(d.code)?` (${d.stage}: ${d.code})`:'';
   throw Error(r.status===403?'Sin permisos de supervisión':'Journal no disponible'+safe);
  }return r.json();
 }
 async function load(){
  if(pending.current)return;pending.current=true;const g=generation.current;
  try{const data=await request();if(g!==generation.current)return;if(!Array.isArray(data.rows))throw Error('Respuesta inválida');setReadOnly(data.read_only===true);setRows(data.rows);setSelected(s=>data.rows.some(r=>r.comment_ref===s)?s:data.rows[0]?.comment_ref||null);setError('');}
  catch(e){if(g===generation.current)setError(e.message);}finally{pending.current=false;}
 }
 useEffect(()=>{generation.current++;setRows([]);setSelected(null);void load();const t=setInterval(()=>{if(!document.hidden&&!editing.current)void load();},10000);return()=>{generation.current++;clearInterval(t);};},[platform]);
 const row=rows.find(r=>r.comment_ref===selected),key=row?platform+row.comment_ref+row.revision:'';
 useEffect(()=>{setPropertyId('');setPropertyConfirmed(false);},[key]);
 async function associate(){
  if(acting.current||!row||!propertyConfirmed)return;acting.current=true;setBusy(true);editing.current=true;setActionError('');setActionResult('');
  try{const r=await request({op:'bind_property',comment:row.comment_ref,revision:row.revision,property_public_id:propertyId.trim(),confirmed:true});
   const messages={bound:'Asociación durable registrada. Evalúa para consultar el precio vigente de DEV.',unchanged:'La asociación ya estaba registrada.',property_unavailable:'La propiedad no existe o no está publicada en DEV. No se guardó una asociación.',association_conflict:'Esta publicación ya tiene otra asociación. No se reemplazó.',association_target_denied:'El comentario o la revisión cambiaron. Actualiza antes de confirmar.'};
   if(!messages[r.status])throw Error('Asociación no acreditada');setActionResult(messages[r.status]);
  }catch(e){setActionError(e.message);}finally{acting.current=false;setBusy(false);editing.current=false;}
 }
 async function action(body){if(acting.current)return;acting.current=true;setBusy(true);editing.current=true;setActionError('');setActionResult('');try{const r=await request(body);if(body.op==='approve'&&r.status!=='approved_not_sent')throw Error('La revisión cambió; vuelve a evaluar antes de aprobar');if(body.op==='evaluate'&&(r.status!=='evaluated'||!Number.isSafeInteger(r.processed)||r.processed<0))throw Error('Evaluación no acreditada');setActionResult(body.op==='approve'?'Aprobación registrada sin publicar':`Evaluación completada: ${r.processed} comentarios procesados`);await load();}catch(e){setActionError(e.message);}finally{acting.current=false;setBusy(false);editing.current=false;}}
 return <section aria-label="Revisión comercial de comentarios" style={{padding:12,overflow:'auto',maxHeight:'70vh',background:'#f0f5ff'}}>
  <h3>Revisión comercial DEV · sin publicaciones</h3>
  <p>Propuestas por reglas verificables; IA generativa no activada. Aprobar guarda auditoría, no envía.</p>
  <nav aria-label="Plataforma de comentarios">{['instagram','facebook'].map(p=><button key={p} disabled={busy} aria-pressed={platform===p} onClick={()=>setPlatform(p)}>{p==='instagram'?'Instagram':'Facebook'}</button>)}</nav>
  <button disabled={busy||readOnly} onClick={()=>action({op:'evaluate'})}>Evaluar comentarios (sin publicar)</button>
  {platform==='facebook'&&<p>Conexión aislada: Emporio Comentarios DEV · Sender OFF. No utiliza la conexión de Messenger.</p>}
  {platform==='facebook'&&['import_history','find_history_proposal','observe_copies','diagnose_organic_reply'].map(op=><button key={op} disabled={busy} onClick={async()=>{if(acting.current)return;acting.current=true;setBusy(true);try{const r=await request({op});setActionResult(JSON.stringify(r));setActionError('');}catch(e){setActionError(e.message);}finally{acting.current=false;setBusy(false);}}}>{op==='diagnose_organic_reply'?'Diagnosticar respuesta orgánica · sólo lectura':op==='observe_copies'?'Comparar copies · sólo observación':op==='import_history'?'Importar muestra histórica autorizada (máximo 1)':'Buscar histórico sin respuesta con propiedad acreditada (máximo 1)'}</button>)}
  {platform==='facebook'&&<button disabled={busy} onClick={async()=>{if(acting.current)return;acting.current=true;setBusy(true);try{const r=await request({op:'diagnose_isolated_dev'});setActionResult(JSON.stringify(r));setActionError('');}catch(e){setActionError(e.message);}finally{acting.current=false;setBusy(false);}}}>Validar token · Emporio Comentarios DEV</button>}
  {readOnly&&<p role="status">Puente DEV autenticado · sólo lectura. Evaluación y aprobación pendientes de certificación.</p>}
  {error&&<p role="alert">{error}</p>}
  {actionError&&<p role="alert">{actionError}</p>}
  {actionResult&&<p role="status">{actionResult}</p>}
  <p>En esta vista: {rows.length} · Escalados: {rows.filter(r=>r.status==='escalated').length} · Candidatos para Ventas: {rows.filter(r=>r.opportunity).length}</p>
  {!rows.length&&!error&&<p>No hay revisiones registradas.</p>}
  <select aria-label="Comentario a revisar" value={selected||''} onChange={e=>setSelected(e.target.value)} style={{maxWidth:'100%'}}><option value="">Selecciona comentario</option>{rows.map((r,i)=><option key={r.comment_ref} value={r.comment_ref}>{i+1}. {r.status} · {r.intent||r.reason}</option>)}</select>
  {row&&<div>{row.historical&&<p>Histórico importado de Meta · no acredita webhook orgánico.</p>}<p>{row.status} · {row.reason} · Destino: Ventas</p><p>{row.approved_text||row.public_proposal||'Requiere revisión humana; faltan datos o evidencia.'}</p>
   {row.evidence?.source==='user_confirmed_dev_observation'&&<p>Certificación histórica con precio confirmado manualmente. No es una lectura vigente del inventario ni habilita publicación.</p>}
   <fieldset disabled={busy||readOnly}><legend>Asociación de publicación a propiedad DEV · {platform==='instagram'?'Instagram':'Facebook'}</legend>
    <p>Confirma sólo después de verificar que esta publicación corresponde exactamente a la ficha. No se infiere por similitud ni se copia Producción.</p>
    <label>Referencia pública de propiedad<input aria-label="Referencia pública de propiedad" value={propertyId} maxLength={80} onFocus={()=>{editing.current=true;}} onBlur={()=>{editing.current=false;}} onChange={e=>{setPropertyId(e.target.value);setPropertyConfirmed(false);}}/></label>
    <label><input type="checkbox" checked={propertyConfirmed} onChange={e=>setPropertyConfirmed(e.target.checked)}/>He verificado la correspondencia exacta de publicación y propiedad</label>
    <button disabled={!propertyConfirmed||!propertyId.trim()} onClick={associate}>Guardar asociación sin publicar</button>
   </fieldset>
   {row.status==='proposed'&&<><label>Editar propuesta<textarea aria-label="Editar propuesta" value={drafts[key]??row.public_proposal??''} onChange={e=>setDrafts(d=>({...d,[key]:e.target.value}))} maxLength={900} style={{width:'100%',boxSizing:'border-box'}}/></label>
    <button disabled={busy||readOnly} onClick={()=>action({op:'approve',comment:row.comment_ref,revision:row.revision,text:drafts[key]??row.public_proposal})}>Aprobar sin publicar</button></>}
   {row.status==='approved'&&<p>Aprobada y registrada. Envío deshabilitado.</p>}
  </div>}
 </section>;
}
