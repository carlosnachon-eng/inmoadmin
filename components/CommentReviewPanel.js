import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
export default function CommentReviewPanel(){
 const [platform,setPlatform]=useState('instagram'),[rows,setRows]=useState([]),[selected,setSelected]=useState(null),[drafts,setDrafts]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),pending=useRef(false),editing=useRef(false);
 async function request(body){
  const {data}=await supabase.auth.getSession();if(!data?.session)throw Error('Sesión requerida');
  const r=await fetch('/api/operaciones/comment-review?platform='+platform,{method:body?'POST':'GET',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error(r.status===403?'Sin permisos de supervisión':'Journal no disponible o conexión DEV no provisionada');return r.json();
 }
 async function load(){
  if(pending.current)return;pending.current=true;const g=generation.current;
  try{const data=await request();if(g!==generation.current)return;if(!Array.isArray(data.rows))throw Error('Respuesta inválida');setRows(data.rows);setSelected(s=>data.rows.some(r=>r.comment_ref===s)?s:data.rows[0]?.comment_ref||null);setError('');}
  catch(e){if(g===generation.current)setError(e.message);}finally{pending.current=false;}
 }
 useEffect(()=>{generation.current++;setRows([]);setSelected(null);void load();const t=setInterval(()=>{if(!document.hidden&&!editing.current)void load();},10000);return()=>{generation.current++;clearInterval(t);};},[platform]);
 const row=rows.find(r=>r.comment_ref===selected),key=row?platform+row.comment_ref+row.revision:'';
 async function action(body){setBusy(true);editing.current=true;try{const r=await request(body);if(body.op==='approve'&&r.status!=='approved_not_sent')throw Error('La revisión cambió; vuelve a evaluar antes de aprobar');await load();}catch(e){setError(e.message);}finally{setBusy(false);editing.current=false;}}
 return <section aria-label="Revisión comercial de comentarios" style={{padding:12,overflow:'auto',maxHeight:'70vh',background:'#f0f5ff'}}>
  <h3>Revisión comercial DEV · sin publicaciones</h3>
  <p>Propuestas por reglas verificables; IA generativa no activada. Aprobar guarda auditoría, no envía.</p>
  <nav aria-label="Plataforma de comentarios">{['instagram','facebook'].map(p=><button key={p} disabled={busy} aria-pressed={platform===p} onClick={()=>setPlatform(p)}>{p==='instagram'?'Instagram':'Facebook'}</button>)}</nav>
  <button disabled={busy} onClick={()=>action({op:'evaluate'})}>Evaluar comentarios (sin publicar)</button>
  {error&&<p role="alert">{error}</p>}
  <p>En esta vista: {rows.length} · Escalados: {rows.filter(r=>r.status==='escalated').length} · Oportunidades para Ventas: {rows.filter(r=>r.opportunity).length}</p>
  {!rows.length&&!error&&<p>No hay revisiones registradas.</p>}
  <select aria-label="Comentario a revisar" value={selected||''} onChange={e=>setSelected(e.target.value)} style={{maxWidth:'100%'}}><option value="">Selecciona comentario</option>{rows.map((r,i)=><option key={r.comment_ref} value={r.comment_ref}>{i+1}. {r.status} · {r.intent||r.reason}</option>)}</select>
  {row&&<div><p>{row.status} · {row.reason} · Destino: Ventas</p><p>{row.public_proposal||'Requiere revisión humana; faltan datos o evidencia.'}</p>
   {row.status==='proposed'&&<><label>Editar propuesta<textarea aria-label="Editar propuesta" value={drafts[key]??row.public_proposal??''} onChange={e=>setDrafts(d=>({...d,[key]:e.target.value}))} maxLength={900} style={{width:'100%',boxSizing:'border-box'}}/></label>
    <button disabled={busy} onClick={()=>action({op:'approve',comment:row.comment_ref,revision:row.revision,text:drafts[key]??row.public_proposal})}>Aprobar sin publicar</button></>}
   {row.status==='approved'&&<p>Aprobada y registrada. Envío deshabilitado.</p>}
  </div>}
 </section>;
}
