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
  getAdminSupabase,
  getServerSupabase,
  nowMxDate,
  safeName,
} from "../../../lib/ejecutivo/workCenter";

function monthBounds() {
  const today = nowMxDate();
  const month = today.slice(0, 7);
  return {
    today,
    start: `${month}-01T00:00:00-06:00`,
    end: `${month}-31T23:59:59-06:00`,
  };
}

function rejectInternal(res, err) {
  console.error("[work-center]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo cargar el centro de trabajo." });
}

const normalize = (value) => String(value || "").trim().toLowerCase();
const ACTIVE_INTERVENTION_STATUSES = new Set(["pendiente", "en_seguimiento", "sin_mejora"]);

function normalizeReason(value) {
  return normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function dateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T12:00:00-06:00`);
  const end = new Date(`${endDate}T12:00:00-06:00`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function capacityForDay(profileId, day, availability) {
  const row = availability.find((item) => item.profile_id === profileId && item.starts_on <= day && (!item.ends_on || item.ends_on >= day));
  return Number(row?.capacity_weight ?? 1);
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
    const { start, end, today } = monthBounds();

    const [
      profilesRes,
      edgesRes,
      availabilityRes,
      opportunitiesRes,
      snapshotsRes,
      citasRes,
      seguimientosRes,
      cierresRes,
      interventionsRes,
    ] = await Promise.all([
      scoped.from("profiles").select("id, email, full_name, role_id, active").eq("active", true),
      scoped.from("gv_supervision_edges").select("id, supervisor_profile_id, subordinate_profile_id, scope, active").eq("scope", "ventas").eq("active", true),
      scoped.from("gv_advisor_availability").select("id, profile_id, status, capacity_weight, reason, starts_on, ends_on"),
      admin
        .from("gv_opportunities")
        .select("*, clientes:cliente_id(nombre, telefono, correo), propiedades:propiedad_id(titulo, public_id)")
        .order("next_action_at", { ascending: true, nullsFirst: false }),
      admin.from("gv_respond_contact_snapshots").select("*").order("respond_last_synced_at", { ascending: false }),
      admin
        .from("citas")
        .select("id, cliente_id, propiedad_id, asesor_id, fecha_hora, estado, notas, confirmacion_estado, confirmacion_actualizada_at, confirmacion_actualizada_por, clientes(nombre), propiedades(titulo)")
        .gte("fecha_hora", start)
        .lte("fecha_hora", end),
      admin.from("seguimientos_cliente").select("id, cliente_id, asesor_id, tipo, created_at").gte("created_at", start),
      admin.from("cierres").select("id, fecha_cierre, comision, advisor_profile_id, operation_type_structured, vendedor").gte("fecha_cierre", today.slice(0, 7) + "-01"),
      scoped.from("gv_management_interventions").select("*, advisor:advisor_profile_id(id, email, full_name), actor:actor_profile_id(id, email, full_name)").order("created_at", { ascending: false }).limit(30),
    ]);

    const snapshotsMissing = snapshotsRes.error?.code === "PGRST205" || /gv_respond_contact_snapshots/i.test(snapshotsRes.error?.message || "");
    const interventionsMissing = interventionsRes.error?.code === "PGRST205" || /gv_management_interventions/i.test(interventionsRes.error?.message || "");
    const firstError = [profilesRes, edgesRes, availabilityRes, opportunitiesRes, snapshotsMissing ? { error: null } : snapshotsRes, citasRes, seguimientosRes, cierresRes, interventionsMissing ? { error: null } : interventionsRes].find((r) => r.error)?.error;
    if (firstError) throw firstError;

    const profiles = profilesRes.data || [];
    const profilesById = new Map(profiles.map((p) => [p.id, p]));
    const opportunities = opportunitiesRes.data || [];
    const snapshots = snapshotsMissing ? [] : (snapshotsRes.data || []);
    const citas = citasRes.data || [];
    const seguimientos = seguimientosRes.data || [];
    const cierres = cierresRes.data || [];
    const availability = availabilityRes.data || [];
    const edges = edgesRes.data || [];
    const interventions = interventionsMissing ? [] : (interventionsRes.data || []);

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
    const scopedOpportunities = opportunities.filter((opp) => scopedAdvisorIds.has(opp.asesor_id));
    const scopedCitas = citas.filter((cita) => scopedAdvisorIds.has(cita.asesor_id));
    const scopedSeguimientos = seguimientos.filter((seg) => scopedAdvisorIds.has(seg.asesor_id));
    const scopedCierres = cierres.filter((cierre) => !cierre.advisor_profile_id || scopedAdvisorIds.has(cierre.advisor_profile_id));
    const scopedSnapshots = snapshots.filter((snap) => scopedAdvisorIds.has(snap.mapped_profile_id));
    const unassignedSnapshots = canManage && mode === "management"
      ? snapshots.filter((snap) => !snap.mapped_profile_id)
      : [];
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
        const citasRequired = requiredCitasForAdvisor(advisor.id, availability, start.slice(0, 10), today);
        const citaPct = kpiPct(advisorSummary.effectiveCitas, citasRequired);
        return {
          id: advisor.id,
          name: safeName(advisor),
          email: advisor.email,
          availability: availabilityNow?.status || "sin_configurar",
          capacityWeight: Number(availabilityNow?.capacity_weight ?? 1),
          citasEffective: advisorSummary.effectiveCitas,
          citasRequired,
          kpiCitasPct: citaPct,
          summary: advisorSummary,
          needsIntervention: Number(availabilityNow?.capacity_weight ?? 1) > 0 && ((citaPct !== null && citaPct < 70) || advisorSummary.waitingResponses > 0 || advisorSummary.overdueActions > 0 || advisorSummary.riskOpportunities > 0),
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
    const activeByAdvisorReason = new Map();
    activeInterventions.forEach((item) => {
      if (!activeByAdvisor.has(item.advisor_profile_id)) activeByAdvisor.set(item.advisor_profile_id, item);
      activeByAdvisorReason.set(`${item.advisor_profile_id}:${normalizeReason(item.reason)}`, item);
    });

    const peoplePriorities = advisorRows
      .filter((row) => row.capacityWeight > 0 && row.interventionSignals.length > 0)
      .map((row) => {
        const indicators = row.interventionSignals.map((signal) => signal.label);
        const reason = indicators.join(" + ");
        const activeIntervention = activeByAdvisorReason.get(`${row.id}:${normalizeReason(reason)}`) || activeByAdvisor.get(row.id) || null;
        return {
          advisorId: row.id,
          advisorName: row.name,
          variant: row.priorityVariant,
          score: row.interventionScore,
          why: indicators,
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
        respondDeepLink: opp.respond_contact_id ? `https://app.respond.io/space/411886/inbox/${encodeURIComponent(String(opp.respond_contact_id))}` : null,
      }))
      .filter((opp) => opp.reason)
      .sort((a, b) => (a.risk === "critico" ? -1 : 0) - (b.risk === "critico" ? -1 : 0) || String(a.nextActionAt || "").localeCompare(String(b.nextActionAt || "")))
      .slice(0, 8);

    const monthClosedNew = scopedCierres
      .filter((c) => normalize(c.operation_type_structured || "nueva") !== "renovacion")
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
      citasEquipo: scopedCitas.filter((cita) => cita.confirmacion_estado === "realizada").length,
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
    };

    return res.status(200).json({
      ok: true,
      environment: process.env.APP_ENV || process.env.VERCEL_ENV || "preview",
      viewer: profile,
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
      data: {
        opportunities: targetOpportunities,
        respondSnapshots: targetSnapshots,
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
