import {
  assertFase2AEnabled,
  assertSupabaseEnvironment,
  authHeaderToken,
  calculateSummary,
  getAdminSupabase,
  getServerSupabase,
  nowMxDate,
} from "../../../lib/ejecutivo/workCenter";

const ALLOWED_STATUS = new Set(["pendiente", "en_seguimiento", "corregida", "sin_mejora", "cerrada_decision_tomada"]);
const ACTIVE_STATUS = ["pendiente", "en_seguimiento", "sin_mejora"];
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
  "atn_area",
  "atn_proxima_accion",
  "metadata",
].join(", ");

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
    start: `${month}-01T00:00:00-06:00`,
    endExclusive: `${nextMonth}-01T00:00:00-06:00`,
  };
}

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
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function compactIndicators(summary) {
  return {
    waitingResponses: Number(summary?.waitingResponses || 0),
    effectiveCitas: Number(summary?.effectiveCitas || 0),
    scheduledCitas: Number(summary?.appointmentStats?.scheduled || 0),
    pendingConfirmationCitas: Number(summary?.appointmentStats?.pendingConfirmation || 0),
    openConversations: Number(summary?.openConversations || 0),
    overdueActions: Number(summary?.overdueActions || 0),
    riskOpportunities: Number(summary?.riskOpportunities || 0),
    activeOpportunities: Number(summary?.activeOpportunities || 0),
    pipeline: Number(summary?.pipeline || 0),
  };
}

function compareIndicators(before = {}, after = {}) {
  const keys = ["waitingResponses", "effectiveCitas", "scheduledCitas", "pendingConfirmationCitas", "openConversations", "overdueActions", "riskOpportunities", "activeOpportunities", "pipeline"];
  return Object.fromEntries(keys.map((key) => {
    const oldValue = Number(before?.[key] || 0);
    const newValue = Number(after?.[key] || 0);
    return [key, { before: oldValue, after: newValue, delta: newValue - oldValue }];
  }));
}

function rejectInternal(res, err) {
  console.error("[management-intervention]", err?.message || err);
  return res.status(500).json({ ok: false, error: "No se pudo registrar la intervención." });
}

async function advisorSnapshot({ scoped, admin, advisorProfileId }) {
  const { start, endExclusive, today } = monthBounds();
  const noData = { data: [], error: null };

  const [opportunitiesRes, citasRes, snapshotsRes] = await Promise.all([
    scoped
      .from("gv_opportunities")
      .select("id, asesor_id, stage, estimated_commission, next_action_at, risk_level, respond_unanswered_since, respond_conversation_status")
      .eq("asesor_id", advisorProfileId),
    admin
      .from("citas")
      .select("id, asesor_id, fecha_hora, estado, confirmacion_estado")
      .eq("asesor_id", advisorProfileId)
      .gte("fecha_hora", start)
      .lt("fecha_hora", endExclusive),
    advisorProfileId
      ? fetchAllPages(() => scoped
        .from("gv_respond_contact_snapshots")
        .select(RESPOND_SNAPSHOT_COLUMNS)
        .eq("mapped_profile_id", advisorProfileId)
        .order("respond_last_synced_at", { ascending: false })
        .order("id", { ascending: true }))
      : Promise.resolve(noData),
  ]);

  const firstError = [opportunitiesRes, citasRes, snapshotsRes].find((r) => r.error)?.error;
  if (firstError) throw firstError;

  const summary = calculateSummary({
    opportunities: opportunitiesRes.data || [],
    snapshots: snapshotsRes.data || [],
    citas: citasRes.data || [],
    profileId: advisorProfileId,
  });

  return {
    capturedAt: new Date().toISOString(),
    capturedForDate: today,
    advisorProfileId,
    ...compactIndicators(summary),
    waitingResponseStats: summary.waitingResponseStats,
  };
}

export default async function handler(req, res) {
  if (!["POST", "PATCH"].includes(req.method)) return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertSupabaseEnvironment();
    assertFase2AEnabled();
    const jwt = authHeaderToken(req);
    if (!jwt) return res.status(401).json({ ok: false, error: "Sesion requerida." });

    const scoped = getServerSupabase(jwt);
    const admin = getAdminSupabase();
    const { data: { user }, error: userError } = await scoped.auth.getUser();
    if (userError || !user) return res.status(401).json({ ok: false, error: "Sesion invalida." });

    const { data: actorProfile, error: actorError } = await admin
      .from("profiles")
      .select("id, email, full_name, role_id, active")
      .eq("id", user.id)
      .maybeSingle();
    if (actorError) throw actorError;
    if (!actorProfile?.active || !["admin", "gerente_ventas"].includes(actorProfile.role_id)) {
      return res.status(403).json({ ok: false, error: "Intervención no autorizada." });
    }

    if (req.method === "POST") {
      const { advisorProfileId, reason, agreedAction, reviewOn = null, notes = "", indicators = {} } = req.body || {};
      if (!advisorProfileId || !reason || !agreedAction) return res.status(400).json({ ok: false, error: "Faltan datos mínimos." });

      const { data: visibleAdvisor, error: advisorError } = await scoped
        .from("profiles")
        .select("id")
        .eq("id", advisorProfileId)
        .maybeSingle();
      if (advisorError) throw advisorError;
      if (!visibleAdvisor && actorProfile.role_id !== "admin") return res.status(403).json({ ok: false, error: "Asesor fuera del scope autorizado." });

      const currentSnapshot = await advisorSnapshot({ scoped, admin, advisorProfileId });
      const enrichedIndicators = {
        ...indicators,
        contextKey: indicators?.contextKey || null,
        initialSnapshot: currentSnapshot,
      };

      const { data: activeInterventions, error: duplicateError } = await scoped
        .from("gv_management_interventions")
        .select("id, status, reason, agreed_action, review_on, created_at, indicators")
        .eq("advisor_profile_id", advisorProfileId)
        .in("status", ACTIVE_STATUS)
        .order("created_at", { ascending: false })
        .limit(20);
      if (duplicateError) throw duplicateError;

      const normalizedReason = normalizeReason(reason);
      const duplicate = (activeInterventions || []).find((item) => (
        indicators?.contextKey
          ? item?.indicators?.contextKey === indicators.contextKey
          : normalizeReason(item.reason) === normalizedReason
      ));
      if (duplicate) {
        return res.status(200).json({ ok: true, duplicate: true, intervention: duplicate });
      }

      const { data: rpcResult, error } = await scoped.rpc("create_management_intervention", {
        p_advisor_profile_id: advisorProfileId,
        p_reason: String(reason).slice(0, 220),
        p_agreed_action: String(agreedAction).slice(0, 220),
        p_review_on: reviewOn || null,
        p_notes: String(notes || "").slice(0, 500) || null,
        p_indicators: enrichedIndicators,
      });
      if (error?.code === "23505" && indicators?.contextKey) {
        const { data: existing, error: existingError } = await scoped
          .from("gv_management_interventions")
          .select("id, status, reason, agreed_action, review_on, created_at, indicators")
          .eq("advisor_profile_id", advisorProfileId)
          .eq("scope", "ventas")
          .eq("indicators->>contextKey", indicators.contextKey)
          .in("status", ACTIVE_STATUS)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) return res.status(200).json({ ok: true, duplicate: true, intervention: existing });
      }
      if (error) throw error;

      return res.status(200).json({ ok: true, ...rpcResult });
    }

    const { id, status, notes = "", reviewOn = null } = req.body || {};
    if (!id || !ALLOWED_STATUS.has(status)) return res.status(400).json({ ok: false, error: "Estatus no válido." });

    const { data: existing, error: existingError } = await scoped
      .from("gv_management_interventions")
      .select("id, advisor_profile_id, status, indicators, review_on")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(403).json({ ok: false, error: "Intervención fuera del scope autorizado." });

    const currentSnapshot = await advisorSnapshot({ scoped, admin, advisorProfileId: existing.advisor_profile_id });
    const initialSnapshot = existing?.indicators?.initialSnapshot || {};
    const comparison = compareIndicators(initialSnapshot, currentSnapshot);
    const nextReviewOn = reviewOn || existing.review_on || null;

    const { data: rpcResult, error } = await scoped.rpc("review_management_intervention", {
      p_intervention_id: id,
      p_status: status,
      p_review_on: nextReviewOn,
      p_notes: String(notes || "").slice(0, 500) || null,
      p_indicators_snapshot: currentSnapshot,
      p_comparison: comparison,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true, ...rpcResult, comparison });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ ok: false, error: "Modulo no habilitado." });
    return rejectInternal(res, err);
  }
}
