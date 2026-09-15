import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const money=value=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(Number(value||0));
const date=value=>value?new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString("es-MX"):"—";
const tabs=["Resumen","Cargos","Ingresos","Aplicaciones","No identificados","Libro banco","Fondos"];
const card={background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,padding:16};
const th={textAlign:"left",padding:"10px 8px",fontSize:11,color:"#6b7280",textTransform:"uppercase",borderBottom:"1px solid #e5e7eb",whiteSpace:"nowrap"};
const td={padding:"10px 8px",fontSize:12,color:"#1f2937",borderBottom:"1px solid #f3f4f6",verticalAlign:"top"};
const statusLabel=value=>({open:"Abierto",partially_paid:"Pago parcial",paid:"Pagado",reversed:"Reversado",registered:"Registrado",partially_applied:"Aplicado parcialmente",applied:"Aplicado",reconciled:"Conciliado",unmatched:"No identificado",partially_matched:"Identificado parcialmente",matched:"Identificado"}[value]||value||"—");
const Badge=({children})=><span style={{padding:"3px 8px",borderRadius:99,background:"#eef2ff",color:"#3730a3",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{children}</span>;
const Empty=({children="Sin movimientos para mostrar."})=><div style={{...card,textAlign:"center",color:"#6b7280",padding:34}}>{children}</div>;
const Table=({headers,children})=><div style={{...card,overflowX:"auto",padding:0}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:760}}><thead><tr>{headers.map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;

export default function FinancialAdminPanel({condominioId}){
  const [active,setActive]=useState("Resumen");
  const [state,setState]=useState({loading:true,data:null,error:null,status:null});
  const [identify,setIdentify]=useState(null);
  const [unitId,setUnitId]=useState("");
  const [busy,setBusy]=useState(false);

  const request=useCallback(async(query="")=>{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token){setState({loading:false,data:null,error:"Tu sesión expiró. Inicia sesión nuevamente.",status:401});return null;}
    const response=await fetch(`/api/condominios/financial-core?condominioId=${encodeURIComponent(condominioId)}${query}`,{headers:{Authorization:`Bearer ${session.access_token}`}});
    const body=await response.json().catch(()=>({code:"INVALID_RESPONSE"}));
    if(!response.ok){setState({loading:false,data:null,error:response.status===403?"No tienes autorización para consultar Finanzas.":response.status===401?"Tu sesión no es válida o expiró.":"No fue posible cargar Finanzas.",status:response.status});return null;}
    return body;
  },[condominioId]);
  const load=useCallback(async()=>{setState(s=>({...s,loading:true,error:null}));const body=await request();if(body)setState({loading:false,data:body.snapshot,error:null,status:200});},[request]);
  useEffect(()=>{load();},[load]);

  const d=state.data||{};
  const maps=useMemo(()=>({
    units:Object.fromEntries((d.units||[]).map(x=>[x.id,x.numero])),funds:Object.fromEntries((d.funds||[]).map(x=>[x.id,x.name])),accounts:Object.fromEntries((d.bankAccounts||[]).map(x=>[x.id,x.display_name])),concepts:Object.fromEntries((d.concepts||[]).map(x=>[x.id,x.name])),periods:Object.fromEntries((d.periods||[]).map(x=>[x.id,x.period_code])),receipts:Object.fromEntries((d.receipts||[]).map(x=>[x.id,x])),charges:Object.fromEntries((d.charges||[]).map(x=>[x.id,x])),transactions:Object.fromEntries((d.transactions||[]).map(x=>[x.id,x]))
  }),[d]);
  const applications=(d.applications||[]).filter(x=>x.status==="active");
  const reconciledReceiptIds=new Set((d.receipts||[]).filter(x=>x.status==="reconciled").map(x=>x.id));
  const appliedByCharge=applications.reduce((a,x)=>{if(reconciledReceiptIds.has(x.receipt_id))a[x.charge_id]=(a[x.charge_id]||0)+Number(x.amount);return a;},{});
  const appliedByReceipt=applications.reduce((a,x)=>{a[x.receipt_id]=(a[x.receipt_id]||0)+Number(x.amount);return a;},{});
  const matchedByTransaction=(d.matches||[]).filter(x=>x.status==="active").reduce((a,x)=>{a[x.bank_transaction_id]=(a[x.bank_transaction_id]||0)+Number(x.amount);return a;},{});
  const totals={charges:(d.charges||[]).filter(x=>x.status!=="reversed").reduce((a,x)=>a+Number(x.amount),0),applied:Object.values(appliedByCharge).reduce((a,x)=>a+x,0),credits:(d.receipts||[]).filter(x=>x.status!=="reversed").reduce((a,x)=>a+Math.max(0,Number(x.amount)-(appliedByReceipt[x.id]||0)),0),unmatched:(d.transactions||[]).filter(x=>x.direction==="credit"&&["unmatched","partially_matched"].includes(x.status)).reduce((a,x)=>a+Math.max(0,Number(x.amount)-(matchedByTransaction[x.id]||0)),0),reconciled:(d.transactions||[]).filter(x=>x.status==="reconciled").length,unreconciled:(d.transactions||[]).filter(x=>x.status!=="reconciled"&&x.status!=="reversed").length,bankDifference:(d.reconciliations||[]).filter(x=>x.status==="confirmed").reduce((a,x)=>a+Number(x.difference||0),0)};

  const identifyTransaction=async()=>{
    if(!identify||!unitId)return;
    setBusy(true);
    const {data:{session}}=await supabase.auth.getSession();
    const response=await fetch("/api/condominios/financial-core",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session?.access_token||""}`},body:JSON.stringify({action:"identify-bank-transaction",condominioId,transactionId:identify.id,unidadId:unitId})});
    const body=await response.json().catch(()=>({}));setBusy(false);
    if(!response.ok){setState(s=>({...s,error:body.code==="LEDGER_INACTIVE"?"Financial Core no está activo.":"No fue posible identificar el movimiento.",status:response.status}));return;}
    setIdentify(null);setUnitId("");await load();
  };
  const openEvidence=async receipt=>{const body=await request(`&evidenceReceiptId=${encodeURIComponent(receipt.id)}`);if(body?.evidence?.signedUrl)window.open(body.evidence.signedUrl,"_blank","noopener,noreferrer");};

  if(state.loading)return <Empty>Cargando Financial Core…</Empty>;
  if(state.error)return <div role="alert" style={{...card,borderColor:"#fecaca",background:"#fff7f7",color:"#991b1b"}}><strong>No se pudo cargar Finanzas.</strong><div style={{marginTop:5}}>{state.error}</div><button onClick={load} style={{marginTop:12}}>Reintentar</button></div>;
  if(!d.ledgerEnabled)return <div style={{...card,borderColor:"#bfdbfe",background:"#eff6ff"}}><h2 style={{margin:"0 0 6px",fontSize:17,color:"#1e3a8a"}}>Financial Core aún no está activado para este condominio.</h2><p style={{margin:0,color:"#475569",fontSize:13}}>La cartera, cuotas y operación actual continúan disponibles en sus secciones existentes. No se puede generar actividad V1 desde esta pantalla.</p></div>;

  return <div>
    <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:16}}>{tabs.map(tab=><button key={tab} onClick={()=>setActive(tab)} style={{border:"1px solid #dbe1ea",background:active===tab?"#1a1a2e":"#fff",color:active===tab?"#fff":"#374151",borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:700,whiteSpace:"nowrap",cursor:"pointer"}}>{tab}</button>)}</div>
    {active==="Resumen"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginBottom:14}}>{[["Cargos emitidos",money(totals.charges)],["Cobrado / aplicado",money(totals.applied)],["Pendiente",money(totals.charges-totals.applied)],["Saldo a favor",money(totals.credits)],["No identificados",money(totals.unmatched)],["Conciliados / no conciliados",`${totals.reconciled} / ${totals.unreconciled}`],["Diferencia bancaria",money(totals.bankDifference)]].map(([label,value])=><div key={label} style={card}><div style={{fontSize:11,color:"#6b7280",fontWeight:700}}>{label}</div><div style={{fontSize:22,fontWeight:800,marginTop:5}}>{value}</div></div>)}</div>
      <h3 style={{fontSize:14}}>Saldos derivados por fondo</h3>{!(d.funds||[]).length?<Empty/>:<Table headers={["Fondo","Tipo","Saldo ledger"]}>{d.funds.map(f=><tr key={f.id}><td style={td}>{f.name}</td><td style={td}>{f.fund_type}</td><td style={td}>{money((d.ledgerBalances||[]).filter(x=>x.fund_id===f.id).reduce((a,x)=>a+Number(x.balance),0))}</td></tr>)}</Table>}
    </div>}
    {active==="Cargos"&&(!(d.charges||[]).length?<Empty/>:<Table headers={["Unidad","Concepto","Periodo","Vencimiento","Importe","Aplicado","Saldo","Estado"]}>{d.charges.map(x=>{const paid=appliedByCharge[x.id]||0;return <tr key={x.id}><td style={td}>{maps.units[x.unidad_id]||"—"}</td><td style={td}>{maps.concepts[x.concept_id]||"—"}</td><td style={td}>{maps.periods[x.period_id]||"—"}</td><td style={td}>{date(x.due_date)}</td><td style={td}>{money(x.amount)}</td><td style={td}>{money(paid)}</td><td style={td}>{money(Number(x.amount)-paid)}</td><td style={td}><Badge>{statusLabel(x.status)}</Badge></td></tr>})}</Table>)}
    {active==="Ingresos"&&(!(d.receipts||[]).length?<Empty/>:<Table headers={["Fecha","Unidad","Importe","Aplicado","Disponible","Fondo(s)","Evidencia","Conciliación"]}>{d.receipts.map(x=>{const applied=appliedByReceipt[x.id]||0;const fundNames=[...new Set(applications.filter(a=>a.receipt_id===x.id).map(a=>maps.funds[a.fund_id]).filter(Boolean))];return <tr key={x.id}><td style={td}>{date(x.received_on)}</td><td style={td}>{maps.units[x.unidad_id]||x.payer_reference||"Sin identificar"}</td><td style={td}>{money(x.amount)}</td><td style={td}>{money(applied)}</td><td style={td}>{money(Number(x.amount)-applied)}</td><td style={td}>{fundNames.join(", ")||"Sin aplicación"}</td><td style={td}>{x.has_evidence?<button onClick={()=>openEvidence(x)}>Abrir 60 s</button>:"—"}</td><td style={td}><Badge>{statusLabel(x.status)}</Badge></td></tr>})}</Table>)}
    {active==="Aplicaciones"&&(!applications.length?<Empty/>:<Table headers={["Movimiento bancario","Recibo","Cargo","Unidad","Fondo","Importe","Estado"]}>{applications.map(x=>{const receipt=maps.receipts[x.receipt_id];const charge=maps.charges[x.charge_id];const matches=(d.matches||[]).filter(m=>m.receipt_id===x.receipt_id&&m.status==="active");return <tr key={x.id}><td style={td}>{matches.map(m=>maps.transactions[m.bank_transaction_id]?.bank_reference||date(maps.transactions[m.bank_transaction_id]?.booked_on)).join(", ")||"Sin match"}</td><td style={td}>{date(receipt?.received_on)} · {money(receipt?.amount)}</td><td style={td}>{maps.concepts[charge?.concept_id]||"—"}</td><td style={td}>{maps.units[charge?.unidad_id]||"—"}</td><td style={td}>{maps.funds[x.fund_id]||"—"}</td><td style={td}>{money(x.amount)}</td><td style={td}><Badge>{statusLabel(receipt?.status)}</Badge></td></tr>})}</Table>)}
    {active==="No identificados"&&(()=>{const rows=(d.transactions||[]).filter(x=>x.direction==="credit"&&["unmatched","partially_matched"].includes(x.status));return !rows.length?<Empty>No hay depósitos pendientes de identificación.</Empty>:<Table headers={["Fecha","Cuenta","Importe","Referencia","Antigüedad","Sin aplicar","Acción"]}>{rows.map(x=><tr key={x.id}><td style={td}>{date(x.booked_on)}</td><td style={td}>{maps.accounts[x.bank_account_id]||"—"}</td><td style={td}>{money(x.amount)}</td><td style={td}>{x.bank_reference||"—"}</td><td style={td}>{Math.max(0,Math.floor((Date.now()-new Date(x.booked_on).getTime())/86400000))} días</td><td style={td}>{money(Number(x.amount)-(matchedByTransaction[x.id]||0))}</td><td style={td}><button onClick={()=>setIdentify(x)}>Identificar</button></td></tr>)}</Table>;})()}
    {active==="Libro banco"&&(!(d.transactions||[]).length?<Empty/>:<Table headers={["Fecha","Cuenta","Tipo","Importe","Referencia","Identificación","Conciliación","Recibos"]}>{d.transactions.map(x=>{const matches=(d.matches||[]).filter(m=>m.bank_transaction_id===x.id&&m.status==="active");return <tr key={x.id}><td style={td}>{date(x.booked_on)}</td><td style={td}>{maps.accounts[x.bank_account_id]||"—"}</td><td style={td}>{x.direction==="credit"?"Entrada":"Salida"}</td><td style={td}>{money(x.amount)}</td><td style={td}>{x.bank_reference||"—"}</td><td style={td}>{maps.units[x.identified_unidad_id]||statusLabel(x.status)}</td><td style={td}><Badge>{x.status==="reconciled"?"Conciliado":"No conciliado"}</Badge></td><td style={td}>{matches.length}</td></tr>})}</Table>)}
    {active==="Fondos"&&(!(d.funds||[]).length?<Empty/>:<Table headers={["Código","Fondo","Tipo","Moneda","Estado","Saldo derivado"]}>{d.funds.map(x=><tr key={x.id}><td style={td}>{x.code}</td><td style={td}>{x.name}</td><td style={td}>{x.fund_type}</td><td style={td}>{x.currency}</td><td style={td}>{x.active?"Activo":"Inactivo"}</td><td style={td}>{money((d.ledgerBalances||[]).filter(b=>b.fund_id===x.id).reduce((a,b)=>a+Number(b.balance),0))}</td></tr>)}</Table>)}
    {identify&&<div role="dialog" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"grid",placeItems:"center",zIndex:2000,padding:16}}><div style={{...card,width:"100%",maxWidth:440}}><h3 style={{marginTop:0}}>Identificar depósito</h3><p style={{fontSize:13,color:"#6b7280"}}>El movimiento original no se modifica destructivamente. Selecciona la unidad identificada.</p><select value={unitId} onChange={e=>setUnitId(e.target.value)} style={{width:"100%",padding:10,marginBottom:14}}><option value="">Selecciona unidad</option>{(d.units||[]).map(u=><option key={u.id} value={u.id}>{u.numero}</option>)}</select><div style={{display:"flex",justifyContent:"flex-end",gap:8}}><button onClick={()=>setIdentify(null)}>Cancelar</button><button disabled={!unitId||busy} onClick={identifyTransaction}>{busy?"Guardando…":"Confirmar"}</button></div></div></div>}
  </div>;
}
