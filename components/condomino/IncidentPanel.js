import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const labels = { nuevo:"Nuevo",revisado:"Revisado",en_proceso:"En proceso",en_espera:"En espera",terminado:"Terminado",cerrado:"Cerrado",cancelado:"Cancelado",cotizado:"Cotizado",aprobado:"Aprobado" };
const toBase64 = (file) => new Promise((resolve, reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(",")[1]); reader.onerror=reject; reader.readAsDataURL(file); });

export default function IncidentPanel({ unit }) {
  const [items,setItems]=useState([]); const [categories,setCategories]=useState([]); const [mode,setMode]=useState("open"); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [loadError,setLoadError]=useState("");
  const [form,setForm]=useState({title:"",description:"",categoryId:"",file:null});
  const call=async(payload)=>{const {data:{session:currentSession}}=await supabase.auth.getSession();if(!currentSession?.access_token)return {ok:false,status:401,code:"SESSION_REQUIRED"};try{const response=await fetch("/api/condominios/incidents",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${currentSession.access_token}`},body:JSON.stringify(payload)});const body=await response.json().catch(()=>({}));return {...body,ok:response.ok&&body.ok!==false,status:response.status};}catch{return {ok:false,status:0,code:"NETWORK_ERROR"};}};
  const safeError=(result)=>result?.status===401?"Tu sesión expiró. Vuelve a ingresar para continuar.":result?.status===403?"No tienes autorización para consultar incidencias de esta unidad.":result?.status>=400&&result?.status<500?"No fue posible completar la solicitud con los datos enviados.":"No fue posible cargar las incidencias. Intenta nuevamente más tarde.";
  const load=async()=>{setLoadError("");const result=await call({action:"list",condominioId:unit.condominio_id,unidadId:unit.unidad_id});if(!result.ok){setItems([]);setCategories([]);setLoadError(safeError(result));return;}setItems(result.incidents||[]);setCategories(result.categories||[]);};
  useEffect(()=>{load();},[unit.unidad_id]);
  const submit=async()=>{setBusy(true);setMessage("");const evidence=form.file?{mimeType:form.file.type,base64:await toBase64(form.file)}:null;const result=await call({action:"create",condominioId:unit.condominio_id,unidadId:unit.unidad_id,idempotencyKey:crypto.randomUUID(),title:form.title,description:form.description,categoryId:form.categoryId||null,evidence});setBusy(false);setMessage(result.ok?"Incidencia registrada.":"No fue posible registrar la incidencia.");if(result.ok){setForm({title:"",description:"",categoryId:"",file:null});load();}};
  const visible=items.filter(i=>mode==="closed"?["cerrado","cancelado"].includes(i.status):!["cerrado","cancelado"].includes(i.status));
  return <section style={{maxWidth:760,margin:"0 auto"}}>
    {loadError&&<p role="alert" style={{background:"#fee2e2",color:"#991b1b",padding:12,borderRadius:8}}>{loadError}</p>}
    <div style={{background:"#fff",padding:16,borderRadius:12,marginBottom:14}}><h2 style={{marginTop:0,fontSize:17}}>Reportar incidencia</h2>
      <input aria-label="Asunto" placeholder="Asunto" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} style={field}/>
      <select aria-label="Categoría" value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})} style={field}><option value="">Sin categoría</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <textarea aria-label="Descripción" placeholder="Describe lo ocurrido" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={4} style={field}/>
      <input aria-label="Fotografías" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setForm({...form,file:e.target.files?.[0]||null})} style={field}/>
      <small>JPEG, PNG o WebP · máximo 5 MB. La evidencia permanece privada.</small><br/>
      <button disabled={busy||form.title.trim().length<3||form.description.trim().length<5} onClick={submit} style={button}>{busy?"Registrando…":"Reportar incidencia"}</button>{message&&<p>{message}</p>}
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12}}><button onClick={()=>setMode("open")} style={mode==="open"?button:secondary}>Abiertas</button><button onClick={()=>setMode("closed")} style={mode==="closed"?button:secondary}>Cerradas</button></div>
    {visible.length===0?<p>No hay incidencias en esta sección.</p>:visible.map(item=><article key={item.id} style={{background:"#fff",padding:16,borderRadius:12,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between"}}><strong>{item.title}</strong><span>{labels[item.status]||item.status}</span></div><p>{item.description}</p><small>{new Date(item.created_at).toLocaleString("es-MX")}</small>{(item.maintenance_ticket_updates||[]).filter(u=>u.visibility==="resident").map(u=><p key={u.id} style={{borderTop:"1px solid #eee",paddingTop:8}}>{u.body||`Estado: ${labels[u.to_status]||u.to_status}`}</p>)}</article>)}
  </section>;
}
const field={width:"100%",boxSizing:"border-box",padding:10,border:"1px solid #d1d5db",borderRadius:8,marginBottom:10};
const button={border:0,borderRadius:8,background:"#b91c3c",color:"#fff",padding:"9px 14px",fontWeight:700,cursor:"pointer",marginTop:10};
const secondary={...button,background:"#e5e7eb",color:"#374151"};
