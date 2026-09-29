import { useEffect, useRef, useState } from "react";
import { sanitizedModelPrivacyChecks } from "../lib/shadow/ai/modelPrivacyTelemetry";
import { sanitizedOutputPrivacyDiagnostics } from "../lib/shadow/ai/outputPrivacyDiagnostics";
import { sanitizedStructuredOutputDiagnostics } from "../lib/shadow/ai/structuredOutputDiagnostics";
import { READ_ONLY_SHADOW_TOOLS } from "../lib/shadow/context";

export default function ManualShadowTurnReview({ supabase, profile, messageRef }) {
  const [local,setLocal]=useState(false),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const flight=useRef(false),executed=useRef(new Set());
  const selection=useRef(messageRef);selection.current=messageRef;
  useEffect(()=>setLocal(["localhost","127.0.0.1"].includes(window.location.hostname)),[]);
  useEffect(()=>{setResult(null);setError("");},[messageRef]);
  if (!local || profile?.active!==true || profile?.role_id!=="admin") return null;
  async function request(action) {
    if(flight.current || (action==="execute" && executed.current.has(result?.authorizationRef))) return;
    flight.current=true;setBusy(true);setError("");
    const authorizationRef=result?.authorizationRef;
    const selectedAtStart=messageRef;
    if(action==="execute") executed.current.add(authorizationRef);
    try {
      const fresh=await supabase.auth.getSession();
      const token=fresh.data?.session?.access_token;
      if(!token) throw new Error("Sesión ausente: ninguna petición enviada.");
      if(selection.current!==selectedAtStart)return;
      const url="/api/operaciones/shadow-ai-real-run?mode=manual_turn"+(action==="read"?(authorizationRef?`&authorizationRef=${authorizationRef}`:`&messageRef=${messageRef}`):"");
      const response=await fetch(url,{method:action==="read"?"GET":"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
        ...(action==="read"?{}:{body:JSON.stringify({mode:"manual_turn",action,...(action==="authorize"?{messageRef}:{authorizationRef})})})});
      const value=await response.json();
      if(!response.ok || !value.ok) throw new Error(value.error || "Solicitud rechazada");
      if(selection.current===selectedAtStart)setResult(value);
    } catch(e) { if(selection.current===selectedAtStart)setError(action==="execute"?"Resultado incierto o rechazado. No repetir ejecución; consultar estado read-only.":e.message); }
    finally {flight.current=false;setBusy(false);}
  }
  const diagnostics=sanitizedOutputPrivacyDiagnostics(result?.telemetry?.failure)||sanitizedStructuredOutputDiagnostics(result?.telemetry?.failure);
  const rounds=(result?.telemetry?.rounds||[]).slice(0,2).map(r=>({round:[1,2].includes(r.round)?r.round:null,
    model:/^claude-[a-z0-9.-]{1,70}$/.test(r.model||"")?r.model:null,
    input_tokens:Number.isSafeInteger(r.input_tokens)?r.input_tokens:null,output_tokens:Number.isSafeInteger(r.output_tokens)?r.output_tokens:null,
    duration_ms:Number.isSafeInteger(r.duration_ms)?r.duration_ms:null}));
  const tools=(result?.telemetry?.tools||[]).filter(t=>READ_ONLY_SHADOW_TOOLS.includes(t.name)).map(t=>({
    name:t.name,round:[1,2].includes(t.round)?t.round:null,ok:t.ok===true,rows:Number.isSafeInteger(t.rows)?t.rows:null,
    duration_ms:Number.isSafeInteger(t.duration_ms)?t.duration_ms:null,
    source:["model","policy","model_proposed","policy_required","both"].includes(t.source)?t.source:null,
    ...(typeof t.identity_resolved==="boolean"?{identity_resolved:t.identity_resolved}:{})}));
  return <section aria-label="Manual Real Shadow DEV" style={{border:"1px solid #aaa",padding:16,marginBottom:16}}>
    <h2>Manual Real Shadow · DEV · un turno</h2>
    <p>Mensaje capturado seleccionado: {messageRef || "selecciona un mensaje"}. Sin captura nueva, sin envío y sin retry.</p>
    <button disabled={busy||!messageRef||(Boolean(result)&&result.status!=="not_authorized")} onClick={()=>request("authorize")}>Autorizar este turno una vez</button>{" "}
    <button disabled={busy||result?.status!=="authorized"||executed.current.has(result?.authorizationRef)} onClick={()=>request("execute")}>Ejecutar autorización única</button>{" "}
    <button disabled={busy||!messageRef} onClick={()=>request("read")}>Consultar estado read-only</button>
    {error&&<p role="alert">{error}</p>}
    {result&&<div aria-live="polite">
      <p>Estado: {result.status} · Persistencia completa acreditada: {result.certified===true?"sí":"no"}</p>
      <p>Decisión: {String(result.decision_persisted===true)} · 3A: {String(result.operational_resolution_persisted===true)} · 3B: {String(result.conversation_action_persisted===true)}</p>
      <pre>{JSON.stringify({receipts:sanitizedModelPrivacyChecks(result.telemetry?.rounds?.map(r=>r.receipt)),diagnostics},null,2)}</pre>
      <pre>{JSON.stringify({rounds,tools},null,2)}</pre>
      {result.operational_resolution&&<p>3A: {result.operational_resolution.case_domain || "sin dominio"} · {result.operational_resolution.case_status} · would_resolve_without_human: {String(result.operational_resolution.would_resolve_without_human===true)}</p>}
      {result.conversation_action&&<><p>3B: {result.conversation_action.conversation_action}</p><p>Propuesta: {result.conversation_action.proposed_message || "sin mensaje"}</p>
        <p>requires_human: {String(result.conversation_action.requires_human)} · auto_send_eligible: {String(result.conversation_action.auto_send_eligible)} · message_safe: {String(result.conversation_action.message_safe)}</p></>}
      <strong>Revisión humana pendiente. Esta vista no autoriza ni ofrece envío.</strong>
    </div>}
  </section>;
}
