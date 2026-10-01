import { useEffect,useMemo,useState } from "react";
import Head from "next/head";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabase";

const money=(v)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:4,maximumFractionDigits:4}).format(Number(v||0));
const number=(v)=>new Intl.NumberFormat("es-MX").format(Number(v||0));

export default function AiUsagePage(){
  const [month,setMonth]=useState(new Date().toLocaleDateString("en-CA",{timeZone:"America/Mexico_City"}).slice(0,7));
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{(async()=>{
    setLoading(true);setError("");
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error("Inicia sesión para consultar el consumo.");
      const r=await fetch("/api/ejecutivo/ai-usage?month="+encodeURIComponent(month),{headers:{Authorization:"Bearer "+session.access_token}});
      const b=await r.json();
      if(!r.ok)throw new Error(b?.error||"No se pudo cargar el consumo.");
      setData(b);
    }catch(e){setError(e.message||"No se pudo cargar el consumo.");setData(null);}
    finally{setLoading(false);}
  })();},[month]);

  const coverage=useMemo(()=>{
    if(!data?.total?.runs)return 0;
    return Math.round((data.total.meteredRuns/data.total.runs)*100);
  },[data]);

  return <Layout>
    <Head><title>Consumo IA · Inmoadmin</title></Head>
    <div style={{maxWidth:1180,margin:"0 auto",padding:"24px 18px 48px"}}>
      <div style={{display:"flex",gap:14,alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:12,fontWeight:900,letterSpacing:.7,textTransform:"uppercase",color:"#6b7280"}}>Dirección · IA</div>
          <h1 style={{margin:"6px 0 4px",fontSize:30,color:"#111827"}}>Consumo y costo por agente</h1>
          <p style={{margin:0,color:"#6b7280"}}>Tokens reales reportados por el proveedor y costo estimado por ejecución.</p>
        </div>
        <label style={{fontSize:12,fontWeight:800,color:"#374151"}}>Mes
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{display:"block",marginTop:6,padding:"9px 11px",border:"1px solid #d1d5db",borderRadius:9}}/>
        </label>
      </div>

      {error&&<div style={{marginTop:20,padding:14,border:"1px solid #fecaca",borderRadius:12,background:"#fef2f2",color:"#991b1b"}}>{error}</div>}
      {loading&&<div style={{marginTop:26,color:"#6b7280"}}>Cargando consumo…</div>}

      {!loading&&data&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14,marginTop:24}}>
          <Card label="Costo estimado" value={money(data.total.estimatedCostUsd)} sub="Total del mes"/>
          <Card label="Tokens" value={number(data.total.totalTokens)} sub={number(data.total.inputTokens)+" entrada · "+number(data.total.outputTokens)+" salida"}/>
          <Card label="Ejecuciones" value={number(data.total.runs)} sub={number(data.total.meteredRuns)+" con medición"}/>
          <Card label="Cobertura medición" value={coverage+"%"} sub="Los runs históricos previos pueden no tener usage"/>
        </div>

        <div style={{marginTop:22,background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,overflow:"hidden"}}>
          <div style={{padding:"17px 18px",borderBottom:"1px solid #e5e7eb",fontWeight:900,color:"#111827"}}>Detalle por agente</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr>{["Agente","Runs","Medidos","Entrada","Salida","Total tokens","Costo estimado"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{data.agents.map(a=><tr key={a.key}>
                <td style={{...td,fontWeight:800}}>{a.label}</td>
                <td style={td}>{number(a.runs)}</td>
                <td style={td}>{number(a.meteredRuns)}</td>
                <td style={td}>{number(a.inputTokens)}</td>
                <td style={td}>{number(a.outputTokens)}</td>
                <td style={td}>{number(a.totalTokens)}</td>
                <td style={{...td,fontWeight:900}}>{money(a.estimatedCostUsd)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>

        <p style={{marginTop:14,fontSize:12,lineHeight:1.55,color:"#6b7280"}}>
          El costo es una estimación basada en los tokens reportados por cada run y la tarifa configurada para el modelo. Los runs sin usage acreditable se muestran como no medidos y no se les asigna costo inventado.
        </p>
      </>}
    </div>
  </Layout>;
}
const Card=({label,value,sub})=><div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:17,boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}>
  <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:.5,color:"#6b7280"}}>{label}</div>
  <div style={{fontSize:27,fontWeight:900,color:"#111827",marginTop:8}}>{value}</div>
  <div style={{fontSize:12,color:"#6b7280",marginTop:5}}>{sub}</div>
</div>;
const th={textAlign:"left",padding:"11px 12px",borderBottom:"1px solid #e5e7eb",background:"#f9fafb",color:"#6b7280",fontSize:11,textTransform:"uppercase",letterSpacing:.4};
const td={padding:"12px",borderBottom:"1px solid #f3f4f6",color:"#374151"};
