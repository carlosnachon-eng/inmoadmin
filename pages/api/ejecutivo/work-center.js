import {
  ADVISOR_ROLE,
  MANAGEMENT_ROLES,
  META_CITAS_DIARIAS,
  META_MENSUAL_NUEVA,
  assertDevSupabaseUrl,
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
  return res.status(500).json({ ok: false, error: "No se pudo cargar el centro de trabajo DEV." });
}

const normalize = (value) => String(value || "").trim().toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertDevSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
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
    ] = await Promise.all([
      scoped.from("profiles").select("id, email, full_name, role_id, active").eq("active", true),
      scoped.from("gv_supervision_edges").select("id, supervisor_profile_id, subordinate_profile_id, scope, active").eq("scope", "ventas").eq("active", true),
      scoped.from("gv_advisor_availability").select("id, profile_id, status, capacity_weight, reason, starts_on, ends_on"),
      admin
        .from("gv_opportunities")
        .select("*, clientes:cliente_id(nombre, telefono, correo), propiedades:propiedad_id(titulo, public_id)")
        .order("next_action_at", { ascending: true, nullsFirst: false }),
      scoped.from("gv_respond_contact_snapshots").select("*").order("respond_last_synced_at", { ascending: false }),
      admin
        .from("citas")
        .select("id, cliente_id, propiedad_id, asesor_id, fecha_hora, estado, notas, confirmacion_estado, confirmacion_actualizada_at, confirmacion_actualizada_por, clientes(nombre), propiedades(titulo)")
        .gte("fecha_hora", start)
        .lte("fecha_hora", end),
      admin.from("seguimientos_cliente").select("id, cliente_id, asesor_id, tipo, created_at").gte("created_at", start),
      admin.from("cierres").select("id, fecha_cierre, comision, advisor_profile_id, operation_type_structured, vendedor").gte("fecha_cierre", today.slice(0, 7) + "-01"),
    ]);

    const snapshotsMissing = snapshotsRes.error?.code === "PGRST205" || /gv_respond_contact_snapshots/i.test(snapshotsRes.error?.message || "");
    const firstError = [profilesRes, edgesRes, availabilityRes, opportunitiesRes, snapshotsMissing ? { error: null } : snapshotsRes, citasRes, seguimientosRes, cierresRes].find((r) => r.error)?.error;
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

    const targetOpportunities = effectiveTargetId ? scopedOpportunities.filter((opp) => opp.asesor_id === effectiveTargetId) : scopedOpportunities;
    const targetSnapshots = effectiveTargetId ? snapshots.filter((snap) => snap.mapped_profile_id === effectiveTargetId) : snapshots;
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
        const advisorSnaps = snapshots.filter((snap) => snap.mapped_profile_id === advisor.id);
        const advisorCitas = scopedCitas.filter((cita) => cita.asesor_id === advisor.id);
        const advisorSummary = calculateSummary({ opportunities: advisorOpps, snapshots: advisorSnaps, citas: advisorCitas, profileId: advisor.id });
        const availabilityNow = availability.find((a) => a.profile_id === advisor.id && a.starts_on <= today && (!a.ends_on || a.ends_on >= today));
        return {
          id: advisor.id,
          name: safeName(advisor),
          email: advisor.email,
          availability: availabilityNow?.status || "sin_configurar",
          capacityWeight: Number(availabilityNow?.capacity_weight ?? 1),
          summary: advisorSummary,
          needsIntervention: advisorSummary.waitingResponses > 0 || advisorSummary.overdueActions > 0 || advisorSummary.riskOpportunities > 0,
        };
      })
      .sort((a, b) => Number(b.needsIntervention) - Number(a.needsIntervention) || a.name.localeCompare(b.name));

    const monthClosedNew = scopedCierres
      .filter((c) => normalize(c.operation_type_structured || "nueva") !== "renovacion")
      .reduce((sum, c) => sum + Number(c.comision || 0), 0);
    const managementSummary = {
      metaEquipo: META_MENSUAL_NUEVA,
      cerradoNuevo: monthClosedNew,
      pipeline: scopedOpportunities.filter((opp) => opp.operation_type === "nueva" && !["cierre_ganado", "cierre_perdido"].includes(opp.stage)).reduce((sum, opp) => sum + Number(opp.estimated_commission || 0), 0),
      citasEquipo: scopedCitas.filter((cita) => cita.confirmacion_estado === "realizada").length,
      citasRequeridasDia: advisorRows.filter((row) => row.capacityWeight > 0).length * META_CITAS_DIARIAS,
      asesoresRequierenIntervencion: advisorRows.filter((row) => row.needsIntervention).length,
      clientesEsperandoRespuesta: summary.waitingResponses,
      oportunidadesEnRiesgo: summary.riskOpportunities,
    };

    return res.status(200).json({
      ok: true,
      dev: true,
      environment: "inmoadmin-dev",
      viewer: profile,
      mode,
      target: requestedTarget || (mode === "mine" ? profile : null),
      summary,
      managementSummary,
      advisorRows,
      items,
      workList: items,
      data: {
        opportunities: targetOpportunities,
        respondSnapshots: targetSnapshots,
      },
      limitations: {
        citaConfirmacion: null,
        respondMapping: "En DEV se usan aliases auditables para probar usuarios sinteticos cuando el email real de Respond.io no coincide con el Auth DEV.",
        respondMigration: snapshotsMissing ? "Pendiente ejecutar migracion 202608080004 para snapshots Respond.io." : null,
      },
    });
  } catch (err) {
    return rejectInternal(res, err);
  }
}
