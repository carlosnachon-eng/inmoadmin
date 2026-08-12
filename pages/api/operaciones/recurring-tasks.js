import { createClient } from "@supabase/supabase-js";
import { isAdministrativeWorkCenterRole } from "../../../lib/operaciones/administrativeWorkCenter";

const RPC_BY_ACTION = {
  create: "create_operational_recurring_task",
  edit: "edit_operational_recurring_task",
  suspend: "suspend_operational_recurring_task",
  reactivate: "reactivate_operational_recurring_task",
  disable: "disable_operational_recurring_task",
  complete: "complete_operational_recurring_task",
};

const RPC_FIELDS = {
  create: [
    "p_title", "p_category", "p_responsible_profile_id", "p_recurrence_unit",
    "p_recurrence_interval", "p_next_due_at", "p_property_id", "p_condominium_id",
    "p_recurrence_weekday", "p_recurrence_month_day", "p_lead_days", "p_timezone",
    "p_provider_name", "p_instructions", "p_task_key",
  ],
  edit: [
    "p_task_id", "p_expected_version", "p_title", "p_category",
    "p_responsible_profile_id", "p_recurrence_unit", "p_recurrence_interval",
    "p_next_due_at", "p_property_id", "p_condominium_id", "p_recurrence_weekday",
    "p_recurrence_month_day", "p_lead_days", "p_timezone", "p_provider_name",
    "p_instructions",
  ],
  suspend: ["p_task_id", "p_expected_version", "p_reason"],
  reactivate: ["p_task_id", "p_expected_version", "p_mode", "p_new_next_due_at"],
  disable: ["p_task_id", "p_expected_version", "p_reason"],
  complete: ["p_task_id", "p_expected_due_at", "p_completion_note", "p_evidence_storage_path"],
};

const TASK_FIELDS = [
  "id", "task_key", "title", "category", "instructions", "responsible_profile_id",
  "provider_name", "property_id", "condominium_id", "recurrence_unit",
  "recurrence_interval", "recurrence_weekday", "recurrence_month_day", "due_time",
  "timezone", "next_due_at", "lead_days", "state", "last_completed_at",
  "suspended_at", "suspension_reason", "disabled_at", "disable_reason", "created_at",
  "updated_at", "version",
].join(", ");

const EXECUTION_FIELDS = [
  "id", "task_id", "scheduled_due_at", "completed_at", "completed_by",
  "completion_note", "next_due_at_generated", "missed_occurrences_count", "created_at",
].join(", ");

function getClient(key, token = null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function rpcArguments(action, input) {
  const allowed = RPC_FIELDS[action] || [];
  return Object.fromEntries(allowed
    .filter((field) => Object.prototype.hasOwnProperty.call(input, field))
    .map((field) => [field, input[field] === "" ? null : input[field]]));
}

async function authorize(req) {
  const token = bearerToken(req);
  if (!token) return { error: { status: 401, message: "Sesión requerida." } };

  const authenticated = getClient(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token);
  const { data: { user }, error: userError } = await authenticated.auth.getUser(token);
  if (userError || !user) return { error: { status: 401, message: "Sesión inválida." } };

  const { data: profile, error: profileError } = await authenticated
    .from("profiles")
    .select("id, role_id, active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.active || !isAdministrativeWorkCenterRole(profile.role_id)) {
    return { error: { status: 403, message: "Tareas recurrentes no autorizadas para este perfil." } };
  }
  return { authenticated, profile };
}

async function loadCatalog(admin) {
  const [tasksResult, executionsResult, profilesResult, propertiesResult, condominiumsResult] = await Promise.all([
    admin.from("operational_recurring_tasks").select(TASK_FIELDS).order("next_due_at"),
    admin.from("operational_recurring_task_executions").select(EXECUTION_FIELDS)
      .order("completed_at", { ascending: false }).limit(250),
    admin.from("profiles").select("id, full_name, role_id, active")
      .in("role_id", ["admin", "coord_operaciones"]).order("full_name"),
    admin.from("properties").select("id").order("id"),
    admin.from("condominios").select("id").order("id"),
  ]);
  const firstError = [tasksResult, executionsResult, profilesResult, propertiesResult, condominiumsResult]
    .find((result) => result.error)?.error;
  if (firstError) throw firstError;
  return {
    tasks: tasksResult.data || [],
    executions: executionsResult.data || [],
    responsibleProfiles: profilesResult.data || [],
    properties: propertiesResult.data || [],
    condominiums: condominiumsResult.data || [],
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  try {
    const auth = await authorize(req);
    if (auth.error) return res.status(auth.error.status).json({ ok: false, error: auth.error.message });

    if (req.method === "POST") {
      const action = String(req.body?.action || "");
      const rpcName = RPC_BY_ACTION[action];
      if (!rpcName) return res.status(400).json({ ok: false, error: "Acción no soportada." });
      const { data, error } = await auth.authenticated.rpc(
        rpcName,
        rpcArguments(action, req.body?.params || {}),
      );
      if (error) {
        const status = error.code === "42501" ? 403 : ["40001", "23505"].includes(error.code) ? 409 : 400;
        return res.status(status).json({ ok: false, error: error.message, code: error.code });
      }
      return res.status(200).json({ ok: true, action, result: data });
    }

    // El cliente privilegiado se crea solamente después de autenticar y autorizar.
    const admin = getClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const catalog = await loadCatalog(admin);
    return res.status(200).json({
      ok: true,
      viewer: { profileId: auth.profile.id, roleId: auth.profile.role_id },
      ...catalog,
    });
  } catch (error) {
    console.error("[operational-recurring-tasks]", error?.message || error);
    return res.status(500).json({ ok: false, error: "No se pudo operar el mantenimiento programado." });
  }
}
