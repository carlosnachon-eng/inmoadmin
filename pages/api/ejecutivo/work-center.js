import {
  ADVISOR_ROLE,
  MANAGEMENT_ROLES,
  META_CITAS_DIARIAS,
  META_MENSUAL_NUEVA,
  assertFase2AEnabled,
  assertSupabaseEnvironment,
  authHeaderToken,
  buildWorkItems,
  calculateSummary,
  citaConfirmationStatus,
  getAdminSupabase,
  getServerSupabase,
  nowMxDate,
  respondInboxLink,
  safeName,
} from "../../../lib/ejecutivo/workCenter";
import { isRespondIncrementalWorkerEnabled } from "../../../lib/ejecutivo/respondSync";

function monthBounds() {
  const today = nowMxDate();
  const month = today.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  const nextMonth = `${nextYear}-${String(nextMonthNumber).padStart(2, "0")}`;
  return {
    today,
    startDate: `${month}-01`,
    start: `${month}-01T00:00:00-06:00`,
    endExclusive: `${nextMonth}-01T00:00:00-06:00`,
  };
}

function rejectInternal(res, err) {
  console.error("[work-center]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo cargar el centro de trabajo." });
}

const normalize = (value) => String(value || "").trim().toLowerCase();
const ACTIVE_INTERVENTION_STATUSES = new Set(["pendiente", "en_seguimiento", "sin_mejora"]);
const SNAPSHOT_PAGE_SIZE = 1000;
const RESPOND_SNAPSHOT_COLUMNS = [
  "id",
  "respond_contact_id",
  "mapped_profile_id",
  "respond_conversation_status",
  "respond_lifecycle",
  "respond_channel_source",
  "respond_unanswered_since",
  "respond_last_synced_at",
  "sales_relevant",
  "respond_record_active",
  "respond_blocked",
  "atn_area",
  "atn_proxima_accion",
  "metadata",
].join(", ");

async function fetchAllPages(makeQuery, pageSize = SNAPSHOT_PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

function normalizeReason(value) {
  return normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function dateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T12:00:00-06:00`);
  const end = new Date(`${endDate}T12:00:00-06:00`);
  while (current <= end) {
    if (current.getDay() !== 0) dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function capacityForDay(profileId, day, availability) {
  const row = availability.find((item) => item.profile_id === profileId && item.starts_on <= day && (!item.ends_on || item.ends_on >= day));
  return Math.max(0, Math.min(1, Number(row?.capacity_weight ?? 0)));
}

function requiredCitasForAdvisor(profileId, availability, startDate, today) {
  return dateRange(startDate, today).reduce((sum, day) => sum + (capacityForDay(profileId, day, availability) * META_CITAS_DIARIAS), 0);
}

function kpiPct(done, required) {
  if (!required) return null;
  return Math.round((Number(done || 0) / Number(required || 0)) * 1000) / 10;
}

function priorityVariant(score) {
  if (score >= 90) return "critica";
  if (score >= 45) return "alta";
  return "normal";
}

function advisorSignals(row) {
  const signals = [];
  const summary = row.summary || {};
  if (row.capacityWeight <= 0) return signals;
  if (row.kpiCitasPct !== null && row.kpiCitasPct < 60) signals.push({ key: "kpi_citas", label: `KPI citas ${row.kpiCitasPct}%`, action: "recuperar ritmo de citas", weight: 35 });
  if (summary.waitingResponses > 0) signals.push({ key: "esperando_respuesta", label: `${summary.waitingResponses} clientes esperando respuesta`, action: `Revisar y responder hoy los ${summary.waitingResponses} clientes pendientes`, weight: Math.min(40, summary.waitingResponses * 4) });
  if (summary.overdueActions > 0) signals.push({ key: "seguimientos_vencidos", label: `${summary.overdueActions} seguimiento${summary.overdueActions === 1 ? "" : "s"} vencido${summary.overdueActions === 1 ? "" : "s"}`, action: summary.overdueActions === 1 ? "Revisar el seguimiento vencido y definir la siguiente acción" : `Revisar los ${summary.overdueActions} seguimientos vencidos y definir siguientes acciones`, weight: summary.overdueActions * 15 });
  if (summary.riskOpportunities > 0) signals.push({ key: "oportunidades_riesgo", label: `${summary.riskOpportunities} oportunidades en riesgo`, action: `Revisar las ${summary.riskOpportunities} oportunidades en riesgo con el asesor`, weight: summary.riskOpportunities * 18 });
  if (summary.appointmentStats?.pendingConfirmation > 0) signals.push({ key: "citas_confirmar", label: `${summary.appointmentStats.pendingConfirmation} citas por confirmar`, action: `Confirmar o reprogramar las ${summary.appointmentStats.pendingConfirmation} citas pendientes`, weight: summary.appointmentStats.pendingConfirmation * 10 });
  return signals;
}

function recommendedAction(signals) {
  const priority = ["esperando_respuesta", "seguimientos_vencidos", "oportunidades_riesgo", "kpi_citas", "citas_confirmar"];
  const picked = priority.map((key) => signals.find((signal) => signal.key === key)).find(Boolean);
  return picked?.action || "Revisar cartera y definir prioridades del día";
}

function maxIso(rows, key) {
  return (rows || []).map((row) => row?.[key]).filter(Boolean).sort().at(-1) || null;
}

function isSalesUnassignedSnapshot(snap) {
  return normalize(snap.atn_area) === "ventas";
}

function availabilityOverlaps(availability = []) {
  const byProfile = new Map();
  availability.forEach((row) => {
    const list = byProfile.get(row.profile_id) || [];
    list.push(row);
    byProfile.set(row.profile_id, list);
  });
  const overlaps = [];
  byProfile.forEach((rows, profileId) => {
    const ordered = rows.slice().sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)));
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const currentEnd = ordered[i].ends_on || "9999-12-31";
      if (currentEnd >= ordered[i + 1].starts_on) {
        overlaps.push({ profileId, firstId: ordered[i].id, secondId: ordered[i + 1].id });
      }
    }
  });
  return overlaps;
}

function stuckOperationReason(opp, today) {
  if (["alto", "critico"].includes(opp.risk_level)) return opp.risk_reason || "Oportunidad marcada en riesgo.";
  if (opp.next_action_at && String(opp.next_action_at).slice(0, 10) < today) return "Próxima acción vencida.";
  const staleHours = opp.last_activity_at ? (Date.now() - new Date(opp.last_activity_at).getTime()) / 36e5 : 999;
  if (staleHours > 96 && !["cierre_ganado", "cierre_perdido"].includes(opp.stage)) return "Sin actividad reciente suficiente.";
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertSupabaseEnvironment();
    assertFase2AEnabled();
    const jwt = authHeaderToken(req);
    if (!jwt) return res.status(401).json({ ok: false, error: "Sesion requerida." });

    const scoped = getServerSupabase(jwt);
    const admin = getAdminSupabase();

    const { data: { user }, error: userError } = await scoped.auth.getUser();
    if (userError || !user) return res.status(401).json({ ok: false, error: "Sesion invalida." });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.active) return res.status(403).json({ ok: false, error: "Perfil no autorizado." });

    const mode = req.query.mode || "mine";
    const targetId = req.query.target || null;
    const canManage = MANAGEMENT_ROLES.has(profile.role_id);
    if (mode !== "mine" && !canManage) return res.status(403).json({ ok: false, error: "Supervision no autorizada." });
    if (profile.role_id === "coord_operaciones") return res.status(403).json({ ok: false, error: "Scope comercial no autorizado." });

    const effectiveTargetId = mode === "mine" ? profile.id : targetId || null;
    const { start, endExclusive, today, startDate } = monthBounds();

    const [
      profilesRes,
      edgesRes,
      availabilityRes,
      interventionsRes,
      interventionEventsRes,
    ] = await Promise.all([
      scoped.from("profiles").select("id, email, full_name, role_id, active").eq("active", true),
      scoped.from("gv_supervision_edges").select("id, supervisor_profile_id, subordinate_profile_id, scope, active").eq("scope", "ventas").eq("active", true),
      scoped.from("gv_advisor_availability").select("id, profile_id, status, capacity_weight, reason, starts_on, ends_on"),
      scoped.from("gv_management_interventions").select("*, advisor:advisor_profile_id(id, email, full_name), actor:actor_profile_id(id, email, full_name)").order("created_at", { ascending: false }).limit(30),
      scoped.from("gv_management_intervention_events").select("id, intervention_id, event_type, actor_profile_id, old_status, new_status, review_on, notes, indicators_snapshot, comparison, created_at").order("created_at", { ascending: false }).limit(120),
    ]);

    const interventionsMissing = interventionsRes.error?.code === "PGRST205" || /gv_management_interventions/i.test(interventionsRes.error?.message || "");
    const interventionEventsMissing = interventionEventsRes.error?.code === "PGRST205" || /gv_management_intervention_events/i.test(interventionEventsRes.error?.message || "");
    const firstError = [profilesRes, edgesRes, availabilityRes, interventionsMissing ? { error: null } : interventionsRes, interventionEventsMissing ? { error: null } : interventionEventsRes].find((r) => r.error)?.error;
    if (firstError) throw firstError;

    const profiles = profilesRes.data || [];
    const profilesById = new Map(profiles.map((p) => [p.id, p]));
    const availability = availabilityRes.data || [];
    const edges = edgesRes.data || [];
    const interventionEvents = interventionEventsMissing ? [] : (interventionEventsRes.data || []);
    const eventsByIntervention = new Map();
    interventionEvents.forEach((event) => {
      const list = eventsByIntervention.get(event.intervention_id) || [];
      list.push(event);
      eventsByIntervention.set(event.intervention_id, list);
    });
    const interventions = interventionsMissing ? [] : (interventionsRes.data || []).map((intervention) => ({
      ...intervention,
      events: eventsByIntervention.get(intervention.id) || [],
    }));

    const visibleAdvisorIds = new Set();
    if (profile.role_id === ADVISOR_ROLE) visibleAdvisorIds.add(profile.id);
    if (profile.role_id === "gerente_ventas") {
      edges.filter((edge) => edge.supervisor_profile_id === profile.id).forEach((edge) => visibleAdvisorIds.add(edge.subordinate_profile_id));
    }
    if (profile.role_id === "admin") {
      profiles.filter((p) => p.role_id === ADVISOR_ROLE).forEach((p) => visibleAdvisorIds.add(p.id));
      edges.filter((edge) => edge.supervisor_profile_id !== profile.id).forEach((edge) => visibleAdvisorIds.add(edge.subordinate_profile_id));
    }
    if (mode === "mine") visibleAdvisorIds.add(profile.id);

    const requestedTarget = effectiveTargetId ? profilesById.get(effectiveTargetId) : null;
    if (mode !== "mine" && effectiveTargetId && !visibleAdvisorIds.has(effectiveTargetId) && profile.role_id !== "admin") {
      return res.status(403).json({ ok: false, error: "El perfil solicitado esta fuera del scope ventas permitido." });
    }

    const scopedAdvisorIds = visibleAdvisorIds.size ? visibleAdvisorIds : new Set([profile.id]);
    const scopedAdvisorIdList = [...scopedAdvisorIds].filter(Boolean);
    const noData = { data: [], error: null };
    const oppQuery = scopedAdvisorIdList.length
      ? scoped
        .from("gv_opportunities")
        .select("*, clientes:cliente_id(nombre), propiedades:propiedad_id(titulo, public_id)")
        .in("asesor_id", scopedAdvisorIdList)
        .order("next_action_at", { ascending: true, nullsFirst: false })
      : Promise.resolve(noData);
    const citasQuery = scopedAdvisorIdList.length
      ? admin
        .from("citas")
        .select("id, cliente_id, propiedad_id, asesor_id, fecha_hora, estado, notas, confirmacion_estado, confirmacion_actualizada_at, confirmacion_actualizada_por, clientes(nombre), propiedades(titulo)")
        .in("asesor_id", scopedAdvisorIdList)
        .gte("fecha_hora", start)
        .lt("fecha_hora", endExclusive)
      : Promise.resolve(noData);
    const seguimientosQuery = scopedAdvisorIdList.length
      ? admin.from("seguimientos_cliente").select("id, cliente_id, asesor_id, tipo, created_at").in("asesor_id", scopedAdvisorIdList).gte("created_at", start)
      : Promise.resolve(noData);
    const cierresQuery = scopedAdvisorIdList.length
      ? admin.from("cierres").select("id, fecha_cierre, comision, advisor_profile_id, operation_type_structured").in("advisor_profile_id", scopedAdvisorIdList).gte("fecha_cierre", startDate)
      : Promise.resolve(noData);
    const mappedSnapshotsQuery = scopedAdvisorIdList.length
      ? fetchAllPages(() => scoped
        .from("gv_respond_contact_snapshots")
        .select(RESPOND_SNAPSHOT_COLUMNS)
        .in("mapped_profile_id", scopedAdvisorIdList)
        .eq("sales_relevant", true)
        .eq("respond_record_active", true)
        .eq("respond_blocked", false)
        .order("respond_last_synced_at", { ascending: false })
        .order("id", { ascending: true }))
      : Promise.resolve(noData);
    const unassignedSnapshotsQuery = canManage && mode === "management"
      ? fetchAllPages(() => admin
        .from("gv_respond_contact_snapshots")
        .select(RESPOND_SNAPSHOT_COLUMNS)
        .is("mapped_profile_id", null)
        .ilike("atn_area", "%ventas%")
        .eq("sales_relevant", true)
        .eq("respond_record_active", true)
        .eq("respond_blocked", false)
        .order("respond_last_synced_at", { ascending: false })
        .order("id", { ascending: true }))
      : Promise.resolve(noData);

    const [
      opportunitiesRes,
      citasRes,
      seguimientosRes,
      cierresRes,
      snapshotsRes,
      unassignedSnapshotsRes,
    ] = await Promise.all([
      oppQuery,
      citasQuery,
      seguimientosQuery,
      cierresQuery,
      mappedSnapshotsQuery,
      unassignedSnapshotsQuery,
    ]);

    const snapshotsMissing = [snapshotsRes, unassignedSnapshotsRes].some((r) => r.error?.code === "PGRST205" || /gv_respond_contact_snapshots/i.test(r.error?.message || ""));
    const dataError = [opportunitiesRes, citasRes, seguimientosRes, cierresRes, snapshotsMissing ? { error: null } : snapshotsRes, snapshotsMissing ? { error: null } : unassignedSnapshotsRes].find((r) => r.error)?.error;
    if (dataError) throw dataError;

    const scopedOpportunities = opportunitiesRes.data || [];
    const scopedCitas = citasRes.data || [];
    const scopedSeguimientos = seguimientosRes.data || [];
    const scopedCierres = cierresRes.data || [];
    const scopedSnapshots = snapshotsMissing ? [] : (snapshotsRes.data || []);
    const unassignedSnapshots = snapshotsMissing ? [] : (unassignedSnapshotsRes.data || []).filter(isSalesUnassignedSnapshot);
    const managementSnapshots = [...scopedSnapshots, ...unassignedSnapshots];

    const targetOpportunities = effectiveTargetId ? scopedOpportunities.filter((opp) => opp.asesor_id === effectiveTargetId) : scopedOpportunities;
    const targetSnapshots = effectiveTargetId ? scopedSnapshots.filter((snap) => snap.mapped_profile_id === effectiveTargetId) : managementSnapshots;
    const targetCitas = effectiveTargetId ? scopedCitas.filter((cita) => cita.asesor_id === effectiveTargetId) : scopedCitas;
    const targetSeguimientos = effectiveTargetId ? scopedSeguimientos.filter((seg) => seg.asesor_id === effectiveTargetId) : scopedSeguimientos;

    const items = buildWorkItems({
      profileId: effectiveTargetId,
      opportunities: targetOpportunities,
      snapshots: targetSnapshots,
      citas: targetCitas,
      seguimientos: targetSeguimientos,
      profilesById,
    });
    const summary = calculateSummary({
      opportunities: targetOpportunities,
      snapshots: targetSnapshots,
      citas: targetCitas,
      profileId: effectiveTargetId,
    });

    const advisorRows = [...visibleAdvisorIds]
      .map((id) => profilesById.get(id))
      .filter(Boolean)
      .filter((p) => p.role_id === ADVISOR_ROLE)
      .map((advisor) => {
        const advisorOpps = scopedOpportunities.filter((opp) => opp.asesor_id === advisor.id);
        const advisorSnaps = scopedSnapshots.filter((snap) => snap.mapped_profile_id === advisor.id);
        const advisorCitas = scopedCitas.filter((cita) => cita.asesor_id === advisor.id);
        const advisorSummary = calculateSummary({ opportunities: advisorOpps, snapshots: advisorSnaps, citas: advisorCitas, profileId: advisor.id });
        const availabilityNow = availability.find((a) => a.profile_id === advisor.id && a.starts_on <= today && (!a.ends_on || a.ends_on >= today));
        const citasRequired = requiredCitasForAdvisor(advisor.id, availability, startDate, today);
        const citaPct = kpiPct(advisorSummary.effectiveCitas, citasRequired);
        const capacityWeight = capacityForDay(advisor.id, today, availability);
        return {
          id: advisor.id,
          name: safeName(advisor),
          email: advisor.email,
          availability: availabilityNow?.status || "sin_configurar",
          capacityWeight,
          citasEffective: advisorSummary.effectiveCitas,
          citasRequired,
          kpiCitasPct: citaPct,
          summary: advisorSummary,
          needsIntervention: capacityWeight > 0 && ((citaPct !== null && citaPct < 70) || advisorSummary.waitingResponses > 0 || advisorSummary.overdueActions > 0 || advisorSummary.riskOpportunities > 0),
        };
      })
      .map((row) => {
        const signals = advisorSignals(row);
        const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
        return {
          ...row,
          interventionScore: score,
          interventionSignals: signals,
          recommendedAction: recommendedAction(signals),
          priorityVariant: priorityVariant(score),
        };
      });

    const unassignedSummary = calculateSummary({ opportunities: [], snapshots: unassignedSnapshots, citas: [], profileId: null });
    if (unassignedSummary.waitingResponses > 0 || unassignedSummary.openConversations > 0) {
      advisorRows.push({
        id: "sin-asignar",
        name: "Sin asignar",
        email: "Contactos Respond.io sin asesor vinculado",
        availability: "requiere_revision",
        capacityWeight: 0,
        citasEffective: 0,
        citasRequired: 0,
        kpiCitasPct: null,
        summary: unassignedSummary,
        needsIntervention: false,
        interventionScore: unassignedSummary.waitingResponses * 4,
        interventionSignals: [],
        recommendedAction: "Revisar asignación de contactos sin responsable",
        priorityVariant: unassignedSummary.waitingResponses > 0 ? "alta" : "normal",
        isUnassigned: true,
      });
    }

    advisorRows
      .sort((a, b) => b.interventionScore - a.interventionScore || a.name.localeCompare(b.name));

    const activeInterventions = interventions.filter((item) => ACTIVE_INTERVENTION_STATUSES.has(item.status));
    const activeByAdvisor = new Map();
    const activeByAdvisorContext = new Map();
    const activeByAdvisorReason = new Map();
    activeInterventions.forEach((item) => {
      if (!activeByAdvisor.has(item.advisor_profile_id)) activeByAdvisor.set(item.advisor_profile_id, item);
      if (item.indicators?.contextKey) activeByAdvisorContext.set(`${item.advisor_profile_id}:${item.indicators.contextKey}`, item);
      activeByAdvisorReason.set(`${item.advisor_profile_id}:${normalizeReason(item.reason)}`, item);
    });

    const peoplePriorities = advisorRows
      .filter((row) => row.capacityWeight > 0 && row.interventionSignals.length > 0)
      .map((row) => {
        const indicators = row.interventionSignals.map((signal) => signal.label);
        const signalKeys = row.interventionSignals.map((signal) => signal.key);
        const primarySignalKey = signalKeys[0] || "revision_gerencial";
        const contextKey = `advisor:${row.id}:signal:${primarySignalKey}`;
        const reason = indicators.join(" + ");
        const activeIntervention = activeByAdvisorContext.get(`${row.id}:${contextKey}`) || activeByAdvisorReason.get(`${row.id}:${normalizeReason(reason)}`) || activeByAdvisor.get(row.id) || null;
        return {
          advisorId: row.id,
          advisorName: row.name,
          variant: row.priorityVariant,
          score: row.interventionScore,
          why: indicators,
          signalKeys,
          primarySignalKey,
          contextKey,
          advisorSnapshot: {
            waitingResponses: row.summary.waitingResponses,
            effectiveCitas: row.summary.effectiveCitas,
            scheduledCitas: row.summary.appointmentStats?.scheduled || 0,
            pendingConfirmationCitas: row.summary.appointmentStats?.pendingConfirmation || 0,
            openConversations: row.summary.openConversations,
            overdueActions: row.summary.overdueActions,
            riskOpportunities: row.summary.riskOpportunities,
            activeOpportunities: row.summary.activeOpportunities,
            pipeline: row.summary.pipeline,
            citasRequired: row.citasRequired,
            kpiCitasPct: row.kpiCitasPct,
          },
          reason,
          explanation: `${row.name} requiere intervención por ${reason}.`,
          recommendedAction: row.recommendedAction,
          activeIntervention,
        };
      });

    const operationsAttention = scopedOpportunities
      .filter((opp) => scopedAdvisorIds.has(opp.asesor_id))
      .map((opp) => ({
        id: opp.id,
        advisorId: opp.asesor_id,
        advisorName: safeName(profilesById.get(opp.asesor_id)),
        client: opp.clientes?.nombre || opp.title,
        property: opp.propiedades?.titulo || "",
        stage: opp.stage,
        risk: opp.risk_level,
        reason: stuckOperationReason(opp, today),
        nextAction: opp.next_action,
        nextActionAt: opp.next_action_at,
        respondDeepLink: respondInboxLink(opp.respond_contact_id),
      }))
      .filter((opp) => opp.reason)
      .sort((a, b) => (a.risk === "critico" ? -1 : 0) - (b.risk === "critico" ? -1 : 0) || String(a.nextActionAt || "").localeCompare(String(b.nextActionAt || "")))
      .slice(0, 8);

    const structuredNewCierres = scopedCierres.filter((c) => c.advisor_profile_id && normalize(c.operation_type_structured) === "nueva");
    const closureCoverage = {
      structuredNew: structuredNewCierres.length,
      structuredRenewal: scopedCierres.filter((c) => normalize(c.operation_type_structured) === "renovacion").length,
      withoutStructuredAdvisor: scopedCierres.filter((c) => !c.advisor_profile_id).length,
      withoutStructuredType: scopedCierres.filter((c) => c.advisor_profile_id && !c.operation_type_structured).length,
      pendingClassification: scopedCierres.filter((c) => !c.advisor_profile_id || !c.operation_type_structured).length,
    };
    const monthClosedNew = structuredNewCierres
      .reduce((sum, c) => sum + Number(c.comision || 0), 0);
    const evaluableAdvisorRows = advisorRows.filter((row) => !row.isUnassigned && row.capacityWeight > 0);
    const todayCitas = scopedCitas.filter((cita) => String(cita.fecha_hora || "").slice(0, 10) === today).length;
    const citasRequeridasAcumuladas = evaluableAdvisorRows.reduce((sum, row) => sum + Number(row.citasRequired || 0), 0);
    const citasRequeridasHoy = evaluableAdvisorRows.reduce((sum, row) => sum + (capacityForDay(row.id, today, availability) * META_CITAS_DIARIAS), 0);
    const interventionsPendingRegister = peoplePriorities.filter((priority) => !priority.activeIntervention).length;
    const managementSummary = {
      metaEquipo: META_MENSUAL_NUEVA,
      cerradoNuevo: monthClosedNew,
      pipeline: scopedOpportunities.filter((opp) => opp.operation_type === "nueva" && !["cierre_ganado", "cierre_perdido"].includes(opp.stage)).reduce((sum, opp) => sum + Number(opp.estimated_commission || 0), 0),
      citasEquipo: scopedCitas.filter((cita) => citaConfirmationStatus(cita) === "realizada").length,
      citasRequeridasAcumuladas,
      citasHoy: todayCitas,
      citasRequeridasHoy,
      asesoresRequierenIntervencion: peoplePriorities.length,
      intervencionesPorRegistrar: interventionsPendingRegister,
      intervencionesActivas: activeInterventions.length,
      clientesEsperandoRespuesta: summary.waitingResponses,
      oportunidadesEnRiesgo: summary.riskOpportunities,
      seguimientosVencidos: summary.overdueActions,
      conversacionesAbiertas: summary.openConversations,
      respondLastSyncedAt: maxIso(targetSnapshots, "respond_last_synced_at"),
      closureCoverage,
      waitingResponseStats: summary.waitingResponseStats,
      unassignedSalesRule: "Solo se muestran contactos sin asignar cuando atn_area = ventas.",
      availabilityOverlaps: availabilityOverlaps(availability),
    };

    return res.status(200).json({
      ok: true,
      environment: process.env.APP_ENV || process.env.VERCEL_ENV || "preview",
      viewer: profile,
      capabilities: {
        respondIncrementalWorkerEnabled: isRespondIncrementalWorkerEnabled(),
        respondFullReconciliation: profile.role_id === "admin",
      },
      mode,
      target: requestedTarget || (mode === "mine" ? profile : null),
      summary,
      managementSummary,
      advisorRows,
      peoplePriorities,
      suggestedInterventions: peoplePriorities.filter((priority) => !priority.activeIntervention),
      operationsAttention,
      interventions,
      items,
      workList: items,
      dataCoverage: {
        opportunities: targetOpportunities.length,
        respondSnapshots: targetSnapshots.length,
        snapshotsMissing,
      },
      limitations: {
        citaConfirmacion: null,
        respondMapping: null,
        respondMigration: snapshotsMissing ? "Pendiente ejecutar la migracion de snapshots Respond.io." : null,
      },
    });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ ok: false, error: "Modulo no habilitado." });
    return rejectInternal(res, err);
  }
}
