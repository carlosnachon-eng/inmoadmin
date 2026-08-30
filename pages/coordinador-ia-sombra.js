import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Layout, { brand } from "../components/Layout";
import { supabase } from "../lib/supabase";
import { isQaDevUiEnabled, qaCampaignFixtureScope, SHADOW_QA_FINAL_CAMPAIGN_ID, validateQaCampaignId } from "../lib/shadow/ai/qaOrchestrator";

const ROLES = new Set(["admin", "coord_operaciones"]);
const EVALUATIONS = [
  ["correct", "Correcto"], ["partially_correct", "Parcialmente correcto"],
  ["wrong_intent", "Intención incorrecta"], ["wrong_context", "Contexto incorrecto"],
  ["wrong_action", "Acción incorrecta"], ["wrong_response", "Respuesta incorrecta"], ["unsafe", "Inseguro"],
];
const likelihoodLabel = { high: "Alta", medium: "Media", low: "Baja", unknown: "Sin determinar" };
const providerLabel = { respond_admin: "WhatsApp Administración", respond: "Respond.io", synthetic: "Fixture sintético" };
const directionLabel = { inbound: "Cliente", outbound: "Salida", outbound_human: "Respuesta humana desde WhatsApp Business App" };
const REPLAY_RATINGS = [["correct","Correcta"],["acceptable_with_changes","Aceptable con cambios"],["incorrect","Incorrecta"],["should_escalate","Debió escalar"],["not_evaluable","No evaluable"]];
const REPLAY_REASONS = ["tone","missing_information","wrong_question","requested_existing_document","invented_fact","incorrect_context","unnecessary_escalation","financial_risk","legal_risk","should_have_asked","should_have_stayed_silent","other"];

export default function ShadowCoordinatorPage() {
  const [session, setSession] = useState(null); const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false); const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null); const [error, setError] = useState("");
  const [saving, setSaving] = useState(false); const [evaluation, setEvaluation] = useState("correct");
  const [correction, setCorrection] = useState("");
  const [shadowView, setShadowView] = useState("conversations");
  const [qaRunning, setQaRunning] = useState(false); const [qaReport, setQaReport] = useState(null);
  const [qaFixtureIds, setQaFixtureIds] = useState("");
  const [autoPlan, setAutoPlan] = useState(null);
  const [autoLastResult, setAutoLastResult] = useState(null);
  const [qaCampaignId, setQaCampaignId] = useState(SHADOW_QA_FINAL_CAMPAIGN_ID);
  const [identityData, setIdentityData] = useState(null); const [identityBusy, setIdentityBusy] = useState(false);
  const [identityBootstrap, setIdentityBootstrap] = useState(null); const [identityBootstrapRefs, setIdentityBootstrapRefs] = useState([]);
  const [clientReconciliation, setClientReconciliation] = useState(null); const [clientReconciliationBusy, setClientReconciliationBusy] = useState(false);
  const [existingClientIdentityIds, setExistingClientIdentityIds] = useState({});
  const [reconciliationTenantIds, setReconciliationTenantIds] = useState(""); const [reconciliationOwnerIds, setReconciliationOwnerIds] = useState("");
  const [historicalReplay, setHistoricalReplay] = useState(null); const [historicalReplayBusy, setHistoricalReplayBusy] = useState(false); const [historicalReplayPreview, setHistoricalReplayPreview] = useState(null); const [historicalReplayTurnKeys, setHistoricalReplayTurnKeys] = useState([]);
  const [historicalReviewDrafts, setHistoricalReviewDrafts] = useState({});
  const [explicitRetries, setExplicitRetries] = useState([]); const [explicitRetryBusy, setExplicitRetryBusy] = useState(false);
  const [outputAbResults, setOutputAbResults] = useState({}); const [outputAbBusy, setOutputAbBusy] = useState("");
  const qaDevUiEnabled = isQaDevUiEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const qaFixtureScope = useMemo(() => qaCampaignFixtureScope(qaCampaignId), [qaCampaignId]);
  useEffect(() => { supabase.auth.getSession().then(({ data: { session: value } }) => { setSession(value); setReady(true); }); }, []);
  useEffect(() => { if (!session?.user) return; supabase.from("profiles").select("id,role_id,active,email").eq("id", session.user.id).maybeSingle().then(({ data: value }) => setProfile(value)); }, [session?.user]);
  const authorized = profile?.active && ROLES.has(profile.role_id);
  const load = useCallback(async () => {
    if (!authorized || !session?.access_token) return;
    setError("");
    try {
      const response = await fetch("/api/operaciones/shadow-coordinator", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json(); if (!response.ok) return setError(json.error || "No se pudo cargar.");
      setData(json); setSelectedId((current) => current || json.messages?.[0]?.id || null);
    } catch {
      setError("No se pudo cargar Coordinador IA — Sombra.");
    }
  }, [authorized, session?.access_token]);
  useEffect(() => { load(); }, [load]);
  const loadIdentities = useCallback(async () => {
    if (!authorized || !session?.access_token) return;
    const response = await fetch("/api/operaciones/shadow-identities", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await response.json(); if (response.ok) setIdentityData(json); else setError(json.error || "No se pudieron cargar identidades.");
  }, [authorized, session?.access_token]);
  useEffect(() => { loadIdentities(); }, [loadIdentities]);
  const loadIdentityBootstrap = useCallback(async () => {
    if (!authorized || !session?.access_token) return;
    const response = await fetch("/api/operaciones/shadow-identity-bootstrap", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await response.json(); if (response.ok) setIdentityBootstrap(json); else setError(json.error || "No se pudo preparar el bootstrap histórico.");
  }, [authorized, session?.access_token]);
  useEffect(() => { loadIdentityBootstrap(); }, [loadIdentityBootstrap]);
  const loadClientReconciliation = useCallback(async () => {
    if (!authorized || !session?.access_token) return;
    const response = await fetch("/api/operaciones/client-reconciliation", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await response.json();
    if (response.ok) setClientReconciliation(json); else if (response.status !== 409) setError(json.error || "No se pudo cargar la reconciliación canónica.");
  }, [authorized, session?.access_token]);
  useEffect(() => { loadClientReconciliation(); }, [loadClientReconciliation]);
  const loadHistoricalReplay = useCallback(async () => {
    if (!authorized || !session?.access_token) return;
    const response = await fetch("/api/operaciones/shadow-historical-replay", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await response.json(); if (response.ok) setHistoricalReplay(json); else if (response.status !== 409) setError(json.error || "No se pudo cargar la evaluación histórica.");
  }, [authorized, session?.access_token]);
  useEffect(() => { loadHistoricalReplay(); }, [loadHistoricalReplay]);
  const loadExplicitRetries = useCallback(async () => {
    if (!authorized || !session?.access_token) return;
    const response = await fetch("/api/operaciones/shadow-ai-explicit-retry", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await response.json();
    if (response.ok) setExplicitRetries(json.candidates || []); else if (response.status !== 403) setError(json.error || "No se pudo auditar retries explícitos.");
  }, [authorized, session?.access_token]);
  useEffect(() => { loadExplicitRetries(); }, [loadExplicitRetries]);
  const runOutputAbFixture = async (fixtureId) => {
    if (!authorized || !session?.access_token || outputAbBusy) return;
    setOutputAbBusy(fixtureId); setError("");
    try {
      const runVariant = async (variant) => {
        const response = await fetch("/api/operaciones/shadow-ai-output-ab-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ fixtureId, variant }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "evaluation_failed");
        return json.result;
      };
      const structured = await runVariant("structured");
      const textual = await runVariant("text_json_local");
      setOutputAbResults((current) => ({ ...current, [fixtureId]: {
        fixture_id: fixtureId,
        structured: structured.metrics,
        text_json_local: textual.metrics,
        semantic_equivalence: Boolean(structured.semantic_projection && textual.semantic_projection && JSON.stringify(structured.semantic_projection) === JSON.stringify(textual.semantic_projection)),
      } }));
    } catch {
      setError("No se pudo ejecutar la evaluación A/B.");
    } finally {
      setOutputAbBusy("");
    }
  };
  const executeExplicitRetry = async (candidate) => {
    if (!candidate?.eligible || !window.confirm(`¿Autorizar un child run para ${candidate.runRef}? El run original permanecerá intacto.`)) return;
    setExplicitRetryBusy(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-explicit-retry", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ parentRunId: candidate.runId, authorization: "explicit_user_authorized" }) });
    const json = await response.json(); setExplicitRetryBusy(false);
    if (!response.ok) return setError(json.reason || json.error || "Retry explícito bloqueado.");
    await loadExplicitRetries(); await load();
  };
  const reviewHistoricalReplay = async (caseId) => {
    const draft=historicalReviewDrafts[caseId]||{};
    setHistoricalReplayBusy(true); setError("");
    const response = await fetch("/api/operaciones/shadow-historical-replay", { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`}, body:JSON.stringify({action:"review",caseId,rating:draft.rating,reason:draft.reason||null,humanAutoSendEligible:draft.humanAutoSendEligible,comment:draft.comment||null}) });
    const json=await response.json(); setHistoricalReplayBusy(false); if(!response.ok)return setError(json.error||"No se guardó la evaluación histórica."); await loadHistoricalReplay();
  };
  const operateHistoricalReplay = async (action, payload = {}) => {
    setHistoricalReplayBusy(true); setError("");
    const response=await fetch("/api/operaciones/shadow-historical-replay",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});
    const json=await response.json();setHistoricalReplayBusy(false);if(!response.ok)return setError(json.error||"No se pudo operar la evaluación histórica.");
    if(action==="preview"){setHistoricalReplayPreview(json.preview);setHistoricalReplayTurnKeys([]);}else{await loadHistoricalReplay();}
  };
  const reconcileClient = async (action, candidate = null) => {
    setClientReconciliationBusy(true); setError("");
    const existingIdentityId = candidate ? String(existingClientIdentityIds[candidate.id] || "").trim() : "";
    const selection = action === "prepare" ? { tenantSourceIds: reconciliationTenantIds.split(/[\s,]+/).filter(Boolean), ownerSourceIds: reconciliationOwnerIds.split(/[\s,]+/).filter(Boolean) } : null;
    const response = await fetch("/api/operaciones/client-reconciliation", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action, ...(selection ? { selection } : {}), ...(candidate ? { candidateId: candidate.id } : {}), ...(existingIdentityId ? { existingIdentityId } : {}) }) });
    const json = await response.json(); setClientReconciliationBusy(false);
    if (!response.ok) return setError(json.error || "No se pudo reconciliar la identidad canónica.");
    await loadClientReconciliation();
  };
  const runIdentityBootstrap = async () => {
    if (!identityBootstrapRefs.length || identityBootstrapRefs.length > 10) return;
    setIdentityBusy(true); setError("");
    const response = await fetch("/api/operaciones/shadow-identity-bootstrap", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ contactRefs: identityBootstrapRefs }) });
    const json = await response.json(); setIdentityBusy(false); if (!response.ok) return setError(json.error || "No se pudo evaluar la cohorte histórica.");
    setIdentityBootstrap((current) => ({ ...current, lastResult: json.results })); setIdentityBootstrapRefs([]); await loadIdentities();
  };
  const reviewIdentity = async (identity, action) => {
    setIdentityBusy(true); setError("");
    const body = identity.status === "no_candidate" ? { action: "generate", conversationId: identity.conversationId } : { action, linkId: identity.id };
    const response = await fetch("/api/operaciones/shadow-identities", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const json = await response.json(); setIdentityBusy(false); if (!response.ok) return setError(json.error || "No se pudo revisar la identidad."); await loadIdentities();
  };
  const selected = data?.messages?.find((item) => item.id === selectedId);
  const conversation = data?.conversations?.find((item) => item.id === selected?.conversation_id);
  const matches = useMemo(() => (data?.matches || []).filter((item) => item.message_id === selectedId), [data, selectedId]);
  const evaluations = useMemo(() => (data?.evaluations || []).filter((item) => item.message_id === selectedId), [data, selectedId]);
  const selectedFixtureId = selected?.provider_metadata?.syntheticScenario;
  const aiRun = useMemo(() => (data?.aiRuns || []).find((item) => selected?.real_shadow?.runId ? item.id === selected.real_shadow.runId : item.message_id === selectedId && (!selectedFixtureId || item.campaign_id === qaCampaignId)), [data, selected, selectedId, selectedFixtureId, qaCampaignId]);
  const aiDecision = useMemo(() => (data?.aiDecisions || []).find((item) => item.ai_run_id === aiRun?.id), [data, aiRun?.id]);
  const laterHumanResponse = useMemo(() => !selected ? null : (aiRun?.telemetry_json?.human_response_id ? (data?.messages || []).find((item)=>item.id===aiRun.telemetry_json.human_response_id) : (data?.messages || []).filter((item) => item.conversation_id === selected.conversation_id && item.direction === "outbound_human" && new Date(item.occurred_at) > new Date(selected.occurred_at)).sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at))[0]) || null, [data, selected, aiRun]);
  const turnMessages = useMemo(() => (aiRun?.telemetry_json?.turn_message_ids || []).map((id)=>(data?.messages || []).find((item)=>item.id===id)).filter(Boolean), [data, aiRun]);
  const aiTools = aiDecision?.tool_summary || [];
  const intentCounts = useMemo(() => (data?.messages || []).reduce((acc, item) => ({ ...acc, [item.intent]: (acc[item.intent] || 0) + 1 }), {}), [data]);
  const likelihoodCounts = useMemo(() => (data?.messages || []).reduce((acc, item) => ({ ...acc, [item.administrative_likelihood]: (acc[item.administrative_likelihood] || 0) + 1 }), { high: 0, medium: 0, low: 0, unknown: 0 }), [data]);
  const ambiguousMessageIds = useMemo(() => new Set((data?.matches || []).filter((item) => item.ambiguous).map((item) => item.message_id)), [data]);
  const conversationActionMetrics = useMemo(() => {
    const actions = data?.conversationActions || [];
    return { total: actions.length, auto: actions.filter((item)=>item.auto_send_eligible).length, superseded: actions.filter((item)=>item.status==="superseded").length };
  }, [data?.conversationActions]);
  const saveEvaluation = async () => {
    setSaving(true); setError("");
    const response = await fetch("/api/operaciones/shadow-coordinator", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ messageId: selectedId, classification: evaluation, expectedCorrection: correction }) });
    const json = await response.json(); setSaving(false); if (!response.ok) return setError(json.error || "No se guardó la evaluación.");
    setCorrection(""); await load();
  };
  const qaOrchestrator = async (method = "GET", { retryFailed = false, fixtureIdsOverride = null } = {}) => {
    setQaRunning(true); setError("");
    let validatedCampaignId;
    try { validatedCampaignId = validateQaCampaignId(qaCampaignId); }
    catch { setQaRunning(false); setError("Campaign ID inválido."); return; }
    const fixtureIds = fixtureIdsOverride || qaFixtureIds.split(",").map((item)=>item.trim()).filter(Boolean);
    const url = method === "GET" ? `/api/operaciones/shadow-ai-qa?campaignId=${encodeURIComponent(validatedCampaignId)}` : "/api/operaciones/shadow-ai-qa";
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, ...(method === "POST" ? { body: JSON.stringify({ fixtureIds, retryFailed, campaignId: validatedCampaignId }) } : {}) });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo operar QA P3.");
    setQaReport(json); if (json.missingFixtures) setQaFixtureIds(json.missingFixtures.slice(0,1).join(",")); await load();
  };
  const continueRun = async () => {
    if (!aiRun?.id) return; setQaRunning(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-continue", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ runId: aiRun.id, campaignId: qaCampaignId }) });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo continuar el run.");
    setQaReport(json); await load();
  };
  const runRealShadow = async (continuation = false) => {
    setQaRunning(true); setError("");
    const endpoint = continuation ? "/api/operaciones/shadow-ai-real-continue" : "/api/operaciones/shadow-ai-real-run";
    const body = continuation ? { runId: selected?.real_shadow?.runId } : { messageId: selectedId, authorizationId: selected?.real_shadow?.authorization?.id };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo ejecutar el análisis manual.");
    await load();
  };
  const authorizeRealShadow = async () => {
    setQaRunning(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-real-authorize", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ messageId: selectedId }) });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo autorizar el análisis manual.");
    await load();
  };
  const revokeRealShadow = async () => {
    setQaRunning(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-real-revoke", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ authorizationId: selected?.real_shadow?.authorization?.id }) });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo revocar la autorización.");
    await load();
  };
  const loadAutoBackfillPlan = async () => {
    setQaRunning(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-real-backfill?lookbackDays=5", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo preparar el backfill.");
    setAutoPlan(json);
  };
  const processNextAutoBackfillTurn = async () => {
    setQaRunning(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-real-backfill", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ lookbackDays: 5 }) });
    const json = await response.json(); setQaRunning(false); setAutoLastResult(json);
    if (!response.ok) return setError(json.error || "No se pudo procesar el siguiente turn.");
    await loadAutoBackfillPlan(); await load();
  };
  useEffect(() => {
    if (!authorized || !session?.access_token) return;
    let active = true;
    fetch("/api/operaciones/shadow-ai-real-backfill?lookbackDays=5", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ response, json: await response.json() }))
      .then(({ response, json }) => { if (active && response.ok) setAutoPlan(json); })
      .catch(() => { /* El botón Actualizar estado permite reintentar sin ejecutar IA. */ });
    return () => { active = false; };
  }, [authorized, session?.access_token]);
  const validateRealShadowDevClone = async () => {
    setQaRunning(true); setError("");
    const response = await fetch("/api/operaciones/shadow-ai-real-dev-validate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ messageId: selectedId }) });
    const json = await response.json(); setQaRunning(false); if (!response.ok) return setError(json.error || "No se pudo validar el clone DEV.");
    setQaReport(json);
  };
  if (!ready || (session && !profile)) return <div style={{ padding: 32 }}>Cargando…</div>;
  if (!session) return <div style={{ padding: 32 }}>Inicia sesión para acceder.</div>;
  if (!authorized) return <div style={{ padding: 32 }}>Acceso reservado a Dirección y Coordinación de Operaciones.</div>;
  if (!data && !error) return <Layout view="coordinador_ia_sombra" profile={profile} onLogout={async () => { await supabase.auth.signOut(); window.location.href = "/"; }}><main style={{ padding: 22 }}><p aria-live="polite">Cargando datos Shadow…</p></main></Layout>;
  const card = { background: "#fff", border: `1px solid ${brand.border}`, borderRadius: 12, padding: 14 };
  const retryAvailable = Boolean(selectedFixtureId?.startsWith("p3-") && ["error","timeout"].includes(aiRun?.status) && Number(aiRun?.attempt_number || 1) < 3);
  return <Layout view="coordinador_ia_sombra" profile={profile} onLogout={async () => { await supabase.auth.signOut(); window.location.href = "/"; }}>
    <Head><title>Coordinador IA — Sombra</title></Head>
    <main style={{ padding: 22 }}>
      <div style={{ marginBottom: 16 }}><h1 style={{ margin: 0, color: brand.gray }}>🌒 Coordinador IA — Sombra</h1><p style={{ color: brand.grayLight }}>Sólo observación y evaluación. No envía mensajes ni modifica el ERP.</p></div>
      {qaDevUiEnabled && authorized && <details style={{ ...card, marginBottom: 14 }}><summary>QA sintética P3 (sólo DEV)</summary><label htmlFor="qa-campaign-id"><strong>Campaña</strong></label><input id="qa-campaign-id" aria-label="Campaign ID QA" value={qaCampaignId} onChange={(event)=>{setQaCampaignId(event.target.value);setQaReport(null);}} maxLength={80} autoComplete="off" spellCheck={false} style={{width:"100%",boxSizing:"border-box",padding:9,margin:"6px 0 8px"}}/><p><strong>Estado:</strong> {qaReport?.completed || 0}/{qaReport?.totalFixtures || qaFixtureScope.length} completados · {qaReport?.missingFixtures?.length ?? qaFixtureScope.length} pendientes · {(qaReport?.results || []).filter((item)=>item.status==="error").length} error · {(qaReport?.results || []).filter((item)=>item.status==="timeout").length} timeout</p><p style={{ color: brand.grayLight }}>Una request ejecuta como máximo un fixture explícito. El servidor valida campaña, autenticación, entorno DEV, fixtures sintéticos y bloqueos de mensajes reales/outbound.</p><input aria-label="Fixture QA" value={qaFixtureIds} onChange={(event)=>setQaFixtureIds(event.target.value)} placeholder="p3-11" style={{width:"100%",boxSizing:"border-box",padding:9,marginBottom:8}}/><button disabled={qaRunning||!qaFixtureIds.trim()} onClick={()=>qaOrchestrator("POST")} style={{marginRight:8}}>Ejecutar fixture seleccionado</button><button disabled={qaRunning} onClick={()=>qaOrchestrator("GET")} style={{marginRight:8}}>Mostrar pendientes</button><button disabled={qaRunning} onClick={()=>qaOrchestrator("GET")}>Agregar métricas QA</button>{qaRunning&&<p>Ejecutando fixture…</p>}{qaReport&&<pre style={{overflow:"auto",maxHeight:360}}>{JSON.stringify(qaReport,null,2)}</pre>}</details>}
      {qaDevUiEnabled && authorized && <details style={{ ...card, marginBottom: 14 }}><summary>Auto Shadow conversacional (DEV, preparación)</summary><p>Turnos consecutivos del cliente; una respuesta humana o una pausa mayor a cinco minutos cierra el turno. Este panel sólo calcula el plan y no ejecuta Claude.</p><button disabled={qaRunning} onClick={loadAutoBackfillPlan}>Mostrar plan de 5 días</button>{autoPlan&&<p>{autoPlan.totalTurns} turns · {autoPlan.pending} pendientes · costo estimado USD {Number(autoPlan.estimate?.estimatedCostUsd||0).toFixed(4)}</p>}</details>}
      {authorized && <details style={{ ...card, marginBottom: 14 }} open><summary><strong>Backfill Shadow real</strong></summary><p style={{color:brand.grayLight}}>Procesamiento manual, autenticado y de una sola unidad. Nunca responde clientes ni modifica el ERP.</p><button disabled={qaRunning} onClick={loadAutoBackfillPlan} style={{marginRight:8}}>Actualizar estado</button>{autoPlan && <><p><strong>{autoPlan.pending}</strong> pendientes · {autoPlan.completed} completed · {autoPlan.running} running · {autoPlan.errors} error · {autoPlan.timeouts} timeout</p>{autoPlan.activeTurn&&<p><strong>Turn actual:</strong> {autoPlan.activeTurn.turnKey}… · run {String(autoPlan.activeTurn.runId).slice(0,8)}… · {autoPlan.activeTurn.executionState} · ronda {autoPlan.activeTurn.currentRound}</p>}<button disabled={qaRunning||!autoPlan.enabled||(!autoPlan.pending&&!autoPlan.activeTurn)} onClick={processNextAutoBackfillTurn}>{autoPlan.activeTurn?.executionState==="awaiting_model_round" ? "Continuar turn" : "Procesar siguiente turn pendiente"}</button>{!autoPlan.enabled&&<p style={{color:"#92400e"}}>Backfill apagado por guardas server-side.</p>}</>}{autoLastResult&&<p><strong>Último resultado:</strong> {autoLastResult.status || autoLastResult.error || "sin resultado"}{autoLastResult.processed?.[0]?.runId ? ` · run ${String(autoLastResult.processed[0].runId).slice(0,8)}…` : ""}</p>}</details>}
      {authorized && <details style={{ ...card, marginBottom: 14 }}><summary><strong>Identidades pendientes</strong></summary><p style={{color:brand.grayLight}}>Sólo vínculos confirmados se usan en Auto‑Real. La revisión muestra únicamente contexto minimizado.</p><p>{identityData?.counts?.candidate || 0} candidato único · {identityData?.counts?.conflict || 0} conflicto · {identityData?.counts?.no_candidate || 0} sin candidato · {identityData?.counts?.confirmed || 0} confirmados</p><details><summary>Bootstrap histórico controlado</summary><p style={{color:brand.grayLight}}>Selecciona explícitamente entre 1 y 10 contactos Admin opacos. Esta operación no modifica conversaciones ni confirma identidades.</p>{(identityBootstrap?.contacts || []).slice(0,50).map((item)=><label key={item.contactRef} style={{display:"block",padding:"4px 0"}}><input type="checkbox" checked={identityBootstrapRefs.includes(item.contactRef)} disabled={identityBusy||(!identityBootstrapRefs.includes(item.contactRef)&&identityBootstrapRefs.length>=10)} onChange={(event)=>setIdentityBootstrapRefs((current)=>event.target.checked?[...current,item.contactRef]:current.filter((ref)=>ref!==item.contactRef))}/> Contacto {item.contactRef} · {item.lastInboundAt ? new Date(item.lastInboundAt).toLocaleDateString("es-MX") : "fecha no disponible"}</label>)}<button disabled={identityBusy||!identityBootstrapRefs.length||identityBootstrapRefs.length>10} onClick={runIdentityBootstrap}>Evaluar cohorte seleccionada ({identityBootstrapRefs.length}/10)</button>{identityBootstrap?.lastResult&&<p>{identityBootstrap.lastResult.filter((item)=>item.status==="unique_candidate").length} candidato único · {identityBootstrap.lastResult.filter((item)=>item.status==="conflict").length} conflicto · {identityBootstrap.lastResult.filter((item)=>item.status==="no_candidate").length} sin candidato</p>}</details>{!identityData?.capabilities?.reviewWriteEnabled&&<p><strong>Modo revisión:</strong> confirmación de vínculos Respond deshabilitada.</p>}{(identityData?.identities || []).filter((item)=>item.status!=="confirmed").map((item)=><article key={item.id || item.conversationId} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}><strong>Contacto {item.contactRef}</strong> · {item.status === "candidate" ? "candidato único" : item.status === "conflict" ? "múltiples candidatos/conflicto" : item.status === "no_candidate" ? "sin candidato" : item.status}{item.review&&<><p>{item.review.displayName} · {(item.review.roleLabels||[]).join(" / ")||"Cliente"} · Teléfono ••••{item.review.phoneLast4||"—"}</p><p>{item.review.propertyNames?.join(", ")||"Propiedad no identificada"} · {item.review.activeContractCount||0} contrato(s) activo(s){item.review.contractEndDates?.length?` · vigencia ${item.review.contractEndDates.join(", ")}`:""}</p><p>{item.review.matchMethodLabel}</p></>}<p>confianza {Math.round(Number(item.confidence||0)*100)}%</p>{item.status === "candidate"&&identityData?.capabilities?.reviewWriteEnabled&&<><button disabled={identityBusy} onClick={()=>reviewIdentity(item,"confirm")}>Confirmar vínculo Respond</button><button disabled={identityBusy} onClick={()=>reviewIdentity(item,"reject")} style={{marginLeft:8}}>Rechazar</button><button disabled={identityBusy} onClick={()=>reviewIdentity(item,"conflict")} style={{marginLeft:8}}>Marcar conflicto</button></>}{item.status === "no_candidate" && <button disabled={identityBusy} onClick={()=>reviewIdentity(item,"generate")}>Buscar coincidencia exacta</button>}</article>)}</details>}
      {authorized && clientReconciliation && <details style={{ ...card, marginBottom: 14 }}><summary><strong>Reconciliación de clientes activos</strong></summary><p style={{color:brand.grayLight}}>Preparación y escritura son capacidades independientes. Sólo contratos activos y propietarios administrados; nunca crea cuentas de acceso.</p>{clientReconciliation.capabilities?.prepareEnabled && <div><label>IDs opacos de contratos activos (máximo 5)<textarea value={reconciliationTenantIds} onChange={(event)=>setReconciliationTenantIds(event.target.value)} style={{display:"block",width:"100%",boxSizing:"border-box",margin:"4px 0 8px"}} /></label><label>IDs opacos de propiedades owner (máximo 3)<textarea value={reconciliationOwnerIds} onChange={(event)=>setReconciliationOwnerIds(event.target.value)} style={{display:"block",width:"100%",boxSizing:"border-box",margin:"4px 0 8px"}} /></label><button disabled={clientReconciliationBusy} onClick={()=>reconcileClient("prepare")}>Preparar cohorte explícita</button></div>}{!clientReconciliation.capabilities?.writeEnabled && <p><strong>Modo revisión:</strong> confirmación y cambios canónicos deshabilitados.</p>}{(clientReconciliation.candidates || []).filter((item)=>item.candidate_status!=="confirmed").map((item)=><article key={item.id || item.candidateRef} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}><strong>{item.review?.roleLabel || (item.role_kind === "tenant" ? "Inquilino" : "Propietario")} · {item.review?.displayName || "Sin nombre operativo"}</strong><p style={{margin:"5px 0"}}>Teléfono: {item.review?.phoneLast4 ? `••••${item.review.phoneLast4}` : "No disponible"} · {item.review?.matchMethodLabel || item.reason_code}</p><p style={{margin:"5px 0"}}>{item.role_kind === "tenant" ? `${item.review?.activeContractCount || 0} contrato(s) activo(s)` : `${item.review?.relatedPropertyCount || 0} propiedad(es)`} · {(item.review?.propertyNames || []).join(", ") || "Propiedad no identificada"}</p>{item.role_kind === "tenant" && (item.review?.contractEndDates || []).length>0 && <p style={{margin:"5px 0"}}>Vigencia hasta: {item.review.contractEndDates.join(", ")}</p>}<small>{item.candidate_status.replaceAll("_"," ")} · {item.source_count} fuente(s)</small>{clientReconciliation.capabilities?.writeEnabled && <><label>Unir a identidad existente (UUID opcional)<input aria-label={`Identidad existente ${item.id}`} value={existingClientIdentityIds[item.id] || ""} onChange={(event)=>setExistingClientIdentityIds((current)=>({...current,[item.id]:event.target.value}))} autoComplete="off" style={{display:"block",width:"100%",boxSizing:"border-box",padding:7,margin:"4px 0 8px"}}/></label><button disabled={clientReconciliationBusy} onClick={()=>reconcileClient("confirm",item)}>Confirmar</button><button disabled={clientReconciliationBusy} onClick={()=>reconcileClient("reject",item)} style={{marginLeft:8}}>Rechazar</button><button disabled={clientReconciliationBusy} onClick={()=>reconcileClient("conflict",item)} style={{marginLeft:8}}>Marcar conflicto</button><button disabled={clientReconciliationBusy} onClick={()=>reconcileClient("skip",item)} style={{marginLeft:8}}>Omitir</button></>}</article>)}</details>}
      {error && <div style={{ ...card, background: "#fef2f2", color: "#991b1b", marginBottom: 12 }}>{error}</div>}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, marginBottom: 16 }}>
        {[["Mensajes", data?.messages?.length || 0], ["Eventos operativos", data?.operationalEvents?.length || 0], ["Duplicados", data?.metrics?.duplicate || 0], ["Sanitizados", data?.metrics?.sanitized || 0], ["Revisión humana", data?.messages?.filter(x=>x.requires_human).length || 0], ["Contexto ambiguo", ambiguousMessageIds.size]].map(([label,value]) => <div key={label} style={card}><div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div><div style={{ color: brand.grayLight, fontSize: 12 }}>{label}</div></div>)}
      </section>
      <details style={{ ...card, marginBottom: 16 }} open><summary><strong>Respuestas que habría enviado</strong></summary>
        <p style={{color:brand.grayLight}}>Sólo propuestas Shadow. No existe envío Respond ni acción ERP en esta fase.</p>
        <p>{conversationActionMetrics.total} propuestas · {conversationActionMetrics.auto} candidatas conversacionales · {conversationActionMetrics.superseded} sustituidas por respuesta humana</p>
        {!(data?.conversationActions || []).length ? <p>No hay respuestas propuestas.</p> : (data.conversationActions || []).map((item)=><article key={item.id} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}>
          <strong>{item.case_domain} · {item.conversation_action}</strong>
          <p><strong>Dirección:</strong> {item.interaction_direction || "ambiguous_actor"}{item.operational_follow_up ? " · seguimiento interno no ejecutable" : ""}</p>
          <p>{item.proposed_message || "Sin mensaje propuesto."}</p>
          <p><strong>Evidencia:</strong> {(item.evidence_refs || []).length} referencia(s) · <strong>Confianza:</strong> {Math.round(Number(item.confidence||0)*100)}% · <strong>Auto-send eligible:</strong> {item.auto_send_eligible ? "Sí" : "No"}</p>
          <p><strong>Estado:</strong> {item.status}{item.blocked_reason ? ` · bloqueo: ${item.blocked_reason}` : ""}</p>
        </article>)}
      </details>
      <details style={{ ...card, marginBottom: 16 }}><summary><strong>Mensajes enviados por Administradora IA</strong></summary>
        <p style={{color:brand.grayLight}}>Carril exclusivo de Administración 544519. El límite inicial es 10 claims acumulados; no ejecuta acciones ERP.</p>
        {!(data?.adminOutboundMessages || []).length ? <p>No hay mensajes enviados por la Administradora IA.</p> : (data.adminOutboundMessages || []).map((item)=><article key={item.id} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}>
          <strong>{item.case_domain} · {item.conversation_action}</strong>
          <p>{item.action?.proposed_message || "Mensaje no disponible."}</p>
          <p><strong>Estado:</strong> {item.status} · <strong>Confianza:</strong> {Math.round(Number(item.action?.confidence||0)*100)}% · <strong>Evidencia:</strong> {(item.action?.evidence_refs||[]).length} referencia(s)</p>
          <p><strong>Provider ref:</strong> {item.provider_message_ref || "—"} · <strong>Enviado:</strong> {item.sent_at ? new Date(item.sent_at).toLocaleString("es-MX") : "No"}</p>
          {item.error_code && <p><strong>Bloqueo/error:</strong> {item.error_code}</p>}
        </article>)}
      </details>
      {qaDevUiEnabled && <details style={{ ...card, marginBottom: 16 }} open><summary><strong>DEV · A/B de salida Auto-Real</strong></summary>
        <p style={{color:brand.grayLight}}>Fixtures sintéticos. Compara structured output nativo con JSON textual validado localmente. No ejecuta tools, outbound ni escrituras.</p>
        {["maintenance-missing-location","payment-missing-period","administrative-pending-document"].map((fixtureId)=><article key={fixtureId} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}>
          <strong>{fixtureId}</strong>
          <div><button type="button" disabled={Boolean(outputAbBusy)} onClick={()=>runOutputAbFixture(fixtureId)}>{outputAbBusy===fixtureId?"Ejecutando…":"Ejecutar A/B"}</button></div>
          {outputAbResults[fixtureId]&&<pre style={{whiteSpace:"pre-wrap",fontSize:12}}>{JSON.stringify(outputAbResults[fixtureId],null,2)}</pre>}
        </article>)}
      </details>}
      {authorized && <details style={{ ...card, marginBottom: 16 }}><summary><strong>Retry administrativo de Auto-Real</strong></summary>
        <p style={{color:brand.grayLight}}>Crea un child run auditable; nunca reabre ni modifica el run original. Outbound y R1 deben permanecer apagados.</p>
        {!explicitRetries.length ? <p>No hay runs terminales recientes para auditar.</p> : explicitRetries.map((item)=><article key={item.runId} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}>
          <strong>Run {item.runRef}… · turno {item.turnRef ? `${item.turnRef}…` : "no reconstruible"}</strong>
          <p><strong>Precheck:</strong> {item.eligible ? "Elegible" : `Bloqueado — ${item.reason}`}</p>
          <small>{new Date(item.createdAt).toLocaleString("es-MX")} · parent {item.status}</small>
          {item.eligible && <div><button disabled={explicitRetryBusy} onClick={()=>executeExplicitRetry(item)}>Autorizar child run</button></div>}
        </article>)}
      </details>}
      {authorized && <details style={{ ...card, marginBottom: 16 }}><summary><strong>Evaluación histórica 3B</strong></summary>
        <p style={{color:brand.grayLight}}>Carril aislado de historical replay. No modifica conversaciones, runs naturales ni acciones naturales, y no puede enviar mensajes.</p>
        <button disabled={historicalReplayBusy} onClick={()=>operateHistoricalReplay("preview")}>Previsualizar cohorte</button>{historicalReplayPreview&&<><p>{historicalReplayPreview.selected} elegibles · mantenimiento {historicalReplayPreview.counts?.maintenance||0} · pagos {historicalReplayPreview.counts?.payment||0} · pendientes {historicalReplayPreview.counts?.administrative_pending||0}</p>{(historicalReplayPreview.cases||[]).map((item)=><label key={item.historicalTurnKey} style={{display:"block",padding:"3px 0"}}><input type="checkbox" checked={historicalReplayTurnKeys.includes(item.historicalTurnKey)} disabled={!historicalReplayTurnKeys.includes(item.historicalTurnKey)&&historicalReplayTurnKeys.length>=30} onChange={(event)=>setHistoricalReplayTurnKeys((current)=>event.target.checked?[...current,item.historicalTurnKey]:current.filter((key)=>key!==item.historicalTurnKey))}/> {item.domain} · {item.messageCount} mensaje(s) · {new Date(item.occurredAt).toLocaleDateString("es-MX")} · respuesta humana {item.humanResponseAvailable?"sí":"no"}</label>)}<button disabled={historicalReplayBusy||!historicalReplayTurnKeys.length} onClick={()=>operateHistoricalReplay("prepare",{turnKeys:historicalReplayTurnKeys})}>Preparar selección ({historicalReplayTurnKeys.length}/30)</button></>}
        <p>{historicalReplay?.metrics?.total||0} seleccionados · {historicalReplay?.metrics?.completed||0} evaluados · {Math.round(Number(historicalReplay?.metrics?.safeMessageRate||0)*100)}% mensajes seguros · {historicalReplay?.metrics?.firstOutboundCandidates||0} candidatos ask/request</p>
        {!(historicalReplay?.cases||[]).length?<p>No hay una cohorte histórica preparada.</p>:(historicalReplay.cases||[]).map((item)=><article key={item.id} style={{borderTop:`1px solid ${brand.border}`,padding:"10px 0"}}>
          <strong>{item.case_domain} · {item.conversation_action||item.status}</strong><p>{item.turn_snapshot?.sanitizedText||"Contexto histórico insuficiente."}</p>
          <p><strong>3A:</strong> {item.operational_resolution?.case_status||"pendiente"} · {item.operational_resolution?.proposed_action||"sin propuesta"}</p><p><strong>Dirección:</strong> {item.operational_resolution?.interaction_direction||"ambiguous_actor"}</p><p><strong>Respuesta que habría enviado:</strong> {item.proposed_message||"Sin mensaje."}</p>
          <p><strong>Grounding:</strong> {item.temporal_grounding} · {item.identity_grounding} · <strong>Humano posterior:</strong> {item.human_response_snapshot||"No disponible"}</p>
          <p><strong>Tokens:</strong> {item.input_tokens||0}/{item.output_tokens||0} · USD {Number(item.estimated_cost_usd||0).toFixed(4)} · {item.latency_ms||0} ms</p>
          {item.status==="pending"&&<button disabled={historicalReplayBusy} onClick={()=>operateHistoricalReplay("execute_one",{caseId:item.id})}>Ejecutar este replay</button>}{item.review?<p>Evaluación: {item.review.rating}{item.review.reason?` · ${item.review.reason}`:""} · envío humano {item.review.human_auto_send_eligible==null?"no medido":item.review.human_auto_send_eligible?"sí":"no"}</p>:item.status==="completed"&&<div><select aria-label={`Evaluación ${item.id}`} value={historicalReviewDrafts[item.id]?.rating||""} onChange={(event)=>setHistoricalReviewDrafts((current)=>({...current,[item.id]:{...current[item.id],rating:event.target.value}}))}><option value="">Calificación…</option>{REPLAY_RATINGS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select aria-label={`Elegible humano ${item.id}`} value={historicalReviewDrafts[item.id]?.humanAutoSendEligible==null?"":String(historicalReviewDrafts[item.id].humanAutoSendEligible)} onChange={(event)=>setHistoricalReviewDrafts((current)=>({...current,[item.id]:{...current[item.id],humanAutoSendEligible:event.target.value==="true"}}))}><option value="">¿Se podría enviar sin humano?</option><option value="true">Sí</option><option value="false">No</option></select>{historicalReviewDrafts[item.id]?.rating&&historicalReviewDrafts[item.id].rating!=="correct"&&<select aria-label={`Motivo ${item.id}`} value={historicalReviewDrafts[item.id]?.reason||""} onChange={(event)=>setHistoricalReviewDrafts((current)=>({...current,[item.id]:{...current[item.id],reason:event.target.value}}))}><option value="">Motivo obligatorio…</option>{REPLAY_REASONS.map((reason)=><option key={reason} value={reason}>{reason.replaceAll("_"," ")}</option>)}</select>}<textarea aria-label={`Comentario ${item.id}`} maxLength={500} placeholder="Comentario opcional" value={historicalReviewDrafts[item.id]?.comment||""} onChange={(event)=>setHistoricalReviewDrafts((current)=>({...current,[item.id]:{...current[item.id],comment:event.target.value}}))}/><button disabled={historicalReplayBusy||!historicalReviewDrafts[item.id]?.rating||historicalReviewDrafts[item.id]?.humanAutoSendEligible==null||(historicalReviewDrafts[item.id]?.rating!=="correct"&&!historicalReviewDrafts[item.id]?.reason)} onClick={()=>reviewHistoricalReplay(item.id)}>Guardar evaluación</button></div>}
        </article>)}
      </details>}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button onClick={() => setShadowView("conversations")} aria-pressed={shadowView === "conversations"}>Conversaciones</button><button onClick={() => setShadowView("operational")} aria-pressed={shadowView === "operational"}>Eventos operativos</button></div>
      {shadowView === "operational" && <section style={{ ...card, marginBottom: 16 }}><h2>Eventos operativos</h2>{!(data?.operationalEvents || []).length ? <p>No hay eventos operativos.</p> : data.operationalEvents.map((event) => <article key={event.id} style={{ borderBottom: `1px solid ${brand.border}`, padding: "10px 0" }}><strong>{event.event_type === "maintenance_ticket_created" ? "Ticket creado" : "Cotización aprobada"}</strong><p style={{ margin: "4px 0" }}>Mantenimiento · {event.maintenance_scope === "managed_property" ? "Propiedad administrada" : "Trabajo externo"} · estado {event.payload_safe?.ticketStatus || event.payload_safe?.status}</p>{event.payload_safe?.amount != null && <p style={{ margin: "4px 0" }}>Importe: {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(event.payload_safe.amount))}</p>}<small>Ticket {String(event.ticket_id).slice(0, 8)}…{event.quote_id ? ` · Cotización ${String(event.quote_id).slice(0, 8)}…` : ""} · {new Date(event.occurred_at).toLocaleString("es-MX")}</small></article>)}</section>}
      {shadowView === "conversations" && <>
      <section style={{ ...card, display: "grid", gridTemplateColumns: "repeat(4,minmax(70px,1fr))", gap: 8, marginBottom: 16 }} aria-label="Distribución administrativa">
        {[["High", likelihoodCounts.high], ["Medium", likelihoodCounts.medium], ["Low", likelihoodCounts.low], ["Unknown", likelihoodCounts.unknown]].map(([label,value]) => <div key={label}><strong>{value}</strong><div style={{ color: brand.grayLight, fontSize: 12 }}>{label}</div></div>)}
      </section>
      <div className="shadow-workspace">
        <section style={{ ...card, maxHeight: "72vh", overflow: "auto" }}><h2 style={{ fontSize: 16 }}>Conversaciones observadas</h2>{(data?.messages || []).map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} style={{ width: "100%", textAlign: "left", border: `1px solid ${item.id===selectedId ? brand.red : brand.border}`, background: item.id===selectedId ? brand.redLight : "#fff", borderRadius: 9, padding: 10, marginBottom: 8, cursor: "pointer" }}><strong>{item.direction === "outbound_human" ? "Respuesta humana" : item.intent.replaceAll("_", " ")}</strong><div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: brand.gray }}>{item.sanitized_text}</div><small>{directionLabel[item.direction] || item.direction} · {likelihoodLabel[item.administrative_likelihood]} · {new Date(item.occurred_at).toLocaleString("es-MX")}</small></button>)}</section>
        <section style={card}>{selected ? <>
          <h2 style={{ marginTop: 0 }}>Detalle del mensaje</h2><blockquote style={{ margin: "12px 0", padding: 14, background: "#f9fafb", borderLeft: `4px solid ${brand.red}` }}>{selected.sanitized_text}</blockquote>
          <p><strong>Origen:</strong> {providerLabel[conversation?.provider] || conversation?.provider} · <strong>Dirección:</strong> {directionLabel[selected.direction] || selected.direction} · <strong>Contacto:</strong> {conversation?.contact_hash?.slice(0,12)}…</p>
          {conversation?.provider === "respond_admin" && <details><summary>Detalle técnico</summary><p><code>provider=respond_admin</code> · canal pseudorreferenciado por configuración server-side.</p></details>}
          <p><strong>Intención:</strong> {selected.intent} · <strong>Probabilidad administrativa:</strong> {likelihoodLabel[selected.administrative_likelihood]}</p>
          <p><strong>Reglas:</strong> {(selected.reason_codes || []).join(", ") || "Sin señales"}</p>
          <p><strong>Contexto:</strong> {matches.length ? matches.map(x => x.display_label || x.internal_id).join(", ") : (selected.semantic_context_needed ? "Contexto por identificar" : "No aplica")}</p>
          <p><strong>Información faltante:</strong> {selected.requires_human ? "Se requiere confirmar contexto o intención." : "Ninguna detectada."}</p>
          {matches[0]?.context_href && <a href={matches[0].context_href}>Abrir contexto en modo lectura</a>}
          <div style={{ ...card, background: "#f8fafc", marginTop: 14 }}><h3 style={{marginTop:0}}>Administradora IA</h3>
            {turnMessages.length > 1 && <details><summary>Turno del cliente ({turnMessages.length} mensajes)</summary>{turnMessages.map((item)=><p key={item.id}>{item.sanitized_text}</p>)}</details>}
            {selected.real_shadow?.devTest && <p style={{color:"#92400e",fontWeight:800}}>DEV TEST — clone sintético, nunca se envía ni procesa como mensaje real.</p>}
            {selected.real_shadow?.authorizable && <button disabled={qaRunning} onClick={authorizeRealShadow}>Autorizar análisis</button>}
            {selected.real_shadow?.authorization && <p><strong>Autorización:</strong> {selected.real_shadow.authorization.state === "active" ? `Activa hasta ${new Date(selected.real_shadow.authorization.expiresAt).toLocaleTimeString("es-MX")}` : selected.real_shadow.authorization.state === "consumed" ? "Consumida" : selected.real_shadow.authorization.state === "revoked" ? "Revocada" : "Expirada"}</p>}
            {selected.real_shadow?.eligible && <button disabled={qaRunning} onClick={selected.real_shadow?.devTest ? validateRealShadowDevClone : ()=>runRealShadow(false)}>Analizar en Shadow</button>}
            {selected.real_shadow?.authorization?.state === "active" && <button disabled={qaRunning} onClick={revokeRealShadow} style={{marginLeft:8}}>Revocar autorización</button>}
            {selected.real_shadow?.executionState === "awaiting_model_round" && <button disabled={qaRunning} onClick={()=>runRealShadow(true)}>Continuar análisis</button>}
            {!aiDecision ? <><p style={{marginBottom:0}}>Estado: {aiRun?.execution_state === "awaiting_model_round" ? "Esperando siguiente ronda" : (aiRun?.execution_state || aiRun?.status || "No ejecutado")}</p>{aiRun?.execution_state === "awaiting_model_round" && <div style={{background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:8,padding:10,marginTop:8}}><p style={{marginTop:0}}>Ronda {aiRun.current_round} de {aiRun.max_rounds}. Evidencia persistida: {(aiRun.evidence_ledger || []).length} registro(s).</p><button disabled={qaRunning} onClick={continueRun}>Continuar run</button></div>}{retryAvailable && <div style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:8,padding:10}}><p style={{color:"#9a3412",marginTop:0}}>Intento {Number(aiRun.attempt_number||1)} de 3 falló. Run previo: <code>{aiRun.id}</code></p><button disabled={qaRunning} onClick={()=>qaOrchestrator("POST",{retryFailed:true,fixtureIdsOverride:[selectedFixtureId]})} style={{background:"#9a3412",color:"#fff",border:0,borderRadius:8,padding:"8px 12px",fontWeight:700}}>Reintentar run fallido</button></div>}</> : <>
              <p><strong>Análisis:</strong> {aiDecision.decision_json?.summary}</p>
              <p><strong>Herramientas consultadas:</strong> {aiTools.length ? aiTools.map(x=>`${x.name} (${x.resultCount}) · ${x.source === "policy_required" ? "requerida por Inmoadmin" : x.source === "both" ? "Inmoadmin + Claude" : "propuesta por Claude"}`).join(", ") : "Ninguna"}</p>
              <p><strong>Contexto encontrado:</strong> {aiDecision.decision_json?.contextAssessment}</p>
              <p><strong>Resolución de entidades:</strong> {aiDecision.decision_json?.entityResolutionStatus || "Sin determinar"} · {(aiDecision.decision_json?.resolvedEntities || []).map(x=>x.label).join(", ") || "Sin entidades ERP confirmadas"}</p>
              <p><strong>Grounding:</strong> {aiDecision.decision_json?.groundingStatus === "blocked" ? (aiDecision.decision_json?.groundingReason?.includes("contradiction") ? "Bloqueada — contradice Inmoadmin" : "Bloqueada — sin respaldo suficiente en Inmoadmin") : aiDecision.decision_json?.groundingStatus === "grounded" ? "Respaldada por evidencia ERP" : "Sin hechos ERP críticos"}</p>
              {(aiDecision.decision_json?.evidenceLedger || []).length > 0 && <details><summary>Evidencia ERP canónica</summary>{aiDecision.decision_json.evidenceLedger.map(item=><p key={item.evidenceId}><code>{item.evidenceId}</code> · {Object.entries(item.facts || {}).map(([key,value])=>`${key}=${String(value)}`).join(", ")}</p>)}</details>}
              {(aiDecision.decision_json?.factualClaims || []).length > 0 && <details><summary>Afirmaciones del modelo</summary>{aiDecision.decision_json.factualClaims.map((claim,index)=><p key={`${claim.factType}-${index}`}><code>{claim.factType}</code>={String(claim.value)} · evidencia: {(claim.evidenceIds || []).join(", ") || "ninguna"}</p>)}</details>}
              <p><strong>Acción propuesta:</strong> {aiDecision.proposed_action}</p>
              {aiDecision.decision_json?.responseBlocked ? <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:10,color:"#991b1b"}}><strong>Respuesta bloqueada</strong><p style={{marginBottom:0}}>{aiDecision.proposed_response}</p></div> : <p><strong>Respuesta propuesta:</strong> {aiDecision.proposed_response}</p>}
              <p><strong>Confianza:</strong> {Math.round(Number(aiDecision.confidence||0)*100)}% · <strong>Requiere humano:</strong> {aiDecision.requires_human ? "Sí" : "No"}</p>
              {aiRun?.prompt_version?.includes("real-shadow") && <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}><div style={{...card,background:"#fff"}}><strong>Respuesta humana posterior</strong><p>{laterHumanResponse?.sanitized_text || "No existe una respuesta humana posterior persistida."}</p></div><div style={{...card,background:"#fff"}}><strong>Propuesta de IA (no enviada)</strong><p>{aiDecision.proposed_response}</p></div></div>}
              {aiDecision.escalation_reason && <p><strong>Motivo:</strong> {aiDecision.escalation_reason}</p>}
              <small>{aiRun.model} · {aiRun.prompt_version} · {aiRun.latency_ms || 0} ms</small>
            </>}
          </div>
          <div style={{ marginTop: 16 }}><h3>Evaluación humana</h3><select value={evaluation} onChange={(e)=>setEvaluation(e.target.value)} style={{ width: "100%", padding: 9, marginBottom: 8 }}>{EVALUATIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><textarea value={correction} onChange={(e)=>setCorrection(e.target.value)} maxLength={1000} rows={3} placeholder="Qué debió detectar" style={{ width: "100%", boxSizing: "border-box", padding: 9 }}/><button disabled={saving} onClick={saveEvaluation} style={{ marginTop: 8, background: brand.red, color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontWeight: 700 }}>{saving ? "Guardando…" : "Guardar evaluación"}</button>{evaluations.map(x=><p key={x.id} style={{ fontSize: 12 }}>✓ {x.classification} · {new Date(x.created_at).toLocaleString("es-MX")}</p>)}</div>
        </> : <p>No hay mensajes.</p>}</section>
      </div>
      <details style={{ ...card, marginTop: 14 }}><summary>Métricas por intención</summary><pre>{JSON.stringify(intentCounts, null, 2)}</pre></details>
      </>}
      <style jsx>{`
        .shadow-workspace { display: grid; grid-template-columns: minmax(260px,.8fr) minmax(360px,1.4fr); gap: 14px; }
        @media (max-width: 720px) { .shadow-workspace { grid-template-columns: minmax(0,1fr); } }
      `}</style>
    </main>
  </Layout>;
}
