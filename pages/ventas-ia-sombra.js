import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const fmtTime=(value)=>{
  if(!value)return "—";
  try{return new Intl.DateTimeFormat("es-MX",{dateStyle:"short",timeStyle:"short",timeZone:"America/Mexico_City"}).format(new Date(value));}
  catch{return value;}
};

export default function VentasIaSombra(){
  const [session,setSession]=useState(null);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [filter,setFilter]=useState("all");

  useEffect(()=>{ supabase.auth.getSession().then(({data:{session}})=>setSession(session)); },[]);

  const load=async()=>{
    if(!session?.access_token)return;
    setLoading(true); setError("");
    try{
      const response=await fetch("/api/operaciones/sales-v2-shadow-view",{headers:{Authorization:"Bearer "+session.access_token}});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"No se pudo cargar");
      setRows(body.rows||[]);
    }catch(e){ setError(e.message||"Error"); }
    finally{ setLoading(false); }
  };

  useEffect(()=>{ if(session)load(); },[session]);

  const visible=useMemo(()=>rows.filter((r)=>{
    if(filter==="failed")return r.status==="failed";
    if(filter==="recovery")return String(r.inbound?.event_id||"").startsWith("recovery:");
    if(filter==="live")return !String(r.inbound?.event_id||"").startsWith("recovery:");
    return true;
  }),[rows,filter]);

  return <div style={{minHeight:"100vh",background:brand.bg,fontFamily:"system-ui,sans-serif"}}>
    <PageHeader title="Ventas IA — Sombra" icon="🤖" actions={<button onClick={load} style={{background:brand.red,color:"#fff",border:"none",borderRadius:9,padding:"9px 14px",fontWeight:800,cursor:"pointer"}}>Actualizar</button>}/>
    <div style={{maxWidth:1100,margin:"0 auto",padding:"22px 18px"}}>
      <div style={{background:"#fff",borderRadius:12,padding:14,marginBottom:16,border:"1px solid #e5e7eb"}}>
        <p style={{margin:"0 0 10px",fontSize:13,color:"#374151"}}>Aquí ves lo que habría contestado Sales V2. <strong>No se envía nada desde esta pantalla.</strong></p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["all","Todos"],["live","Nuevos"],["recovery","Recuperados"],["failed","Fallidos"]].map(([key,label])=><button key={key} onClick={()=>setFilter(key)} style={{border:"1px solid #d1d5db",background:filter===key?"#1f2937":"#fff",color:filter===key?"#fff":"#374151",borderRadius:999,padding:"6px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{label}</button>)}
        </div>
      </div>
      {loading&&<div style={{padding:40,textAlign:"center",color:"#6b7280"}}>Cargando...</div>}
      {error&&<div style={{padding:14,background:"#fee2e2",color:"#991b1b",borderRadius:10}}>{error}</div>}
      {!loading&&!error&&visible.length===0&&<div style={{padding:40,textAlign:"center",color:"#6b7280",background:"#fff",borderRadius:12}}>Todavía no hay runs en este filtro.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {visible.map((r)=><div key={r.id} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:11,color:"#6b7280",fontWeight:800,textTransform:"uppercase"}}>{String(r.inbound?.event_id||"").startsWith("recovery:")?"Lead recuperado":"Mensaje nuevo"} · canal {r.inbound?.channel_id||"—"}</div>
              <div style={{marginTop:4,fontSize:12,color:"#6b7280"}}>{fmtTime(r.inbound?.occurred_at)} · contacto {r.inbound?.respond_contact_id||"—"}</div>
            </div>
            <span style={{fontSize:11,fontWeight:800,borderRadius:999,padding:"4px 8px",background:r.status==="idle"?"#dcfce7":"#fee2e2",color:r.status==="idle"?"#166534":"#991b1b"}}>{r.status==="idle"?"OK":"FALLÓ"}</span>
          </div>
          <div style={{marginTop:14}}><div style={{fontSize:11,fontWeight:800,color:"#6b7280",textTransform:"uppercase",marginBottom:4}}>Prospecto escribió</div><div style={{fontSize:14,color:"#111827",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{r.inbound?.sanitized_text||"—"}</div></div>
          <div style={{marginTop:14,background:"#f9fafb",borderRadius:10,padding:12}}><div style={{fontSize:11,fontWeight:800,color:"#6b7280",textTransform:"uppercase",marginBottom:4}}>Sales V2 habría contestado</div><div style={{fontSize:14,color:"#111827",lineHeight:1.55,whiteSpace:"pre-wrap"}}>{r.proposedResponse||"—"}</div></div>
          <div style={{marginTop:12,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            {(r.calledTools||[]).map((tool,i)=><span key={tool+"-"+i} style={{fontSize:11,background:"#eef2ff",color:"#3730a3",padding:"3px 7px",borderRadius:999}}>{tool}</span>)}
            <span style={{fontSize:11,color:"#9ca3af",marginLeft:"auto"}}>{r.latencyMs?((r.latencyMs/1000).toFixed(1)+" s"):"—"}</span>
          </div>
          {r.errorCode&&<div style={{marginTop:10,fontSize:12,color:"#991b1b"}}>Error: {r.errorCode}</div>}
        </div>)}
      </div>
    </div>
  </div>;
}