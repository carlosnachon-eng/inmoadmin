import { createClient } from "@supabase/supabase-js";
import {
  activePortalAccess,
  isValidPortalEmail,
  maskPortalEmail,
  normalizePortalEmail,
  requiresMultiUnitConfirmation,
} from "../../../lib/condominios/portalAccess.mjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const response = (res, status, code, extra = {}) => res.status(status).json({
  ok: status >= 200 && status < 300,
  code,
  ...extra,
});

function clientsForRequest(token) {
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const operatorDb = createClient(supabaseUrl, anonKey, {
    ...options,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const authAdmin = createClient(supabaseUrl, serviceKey, options);
  return { operatorDb, authAdmin };
}

async function authorizeOperator(req, authAdmin) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return { error: "SESSION_REQUIRED", status: 401 };

  const token = match[1].trim();
  const { data: authData, error: authError } = await authAdmin.auth.getUser(token);
  if (authError || !authData?.user?.id) return { error: "INVALID_SESSION", status: 401 };

  const { data: profile, error: profileError } = await authAdmin
    .from("profiles")
    .select("id, role_id, active, roles:role_id(es_externo)")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return { error: "PERMISSION_CHECK_FAILED", status: 503 };
  if (!profile || profile.active === false || profile.roles?.es_externo === true) {
    return { error: "OPERATION_NOT_ALLOWED", status: 403 };
  }

  if (profile.role_id !== "admin") {
    const { data: permission, error: permissionError } = await authAdmin
      .from("permisos_modulo")
      .select("puede_ver, puede_editar")
      .eq("role_id", profile.role_id)
      .eq("modulo", "condominios")
      .maybeSingle();
    if (permissionError) return { error: "PERMISSION_CHECK_FAILED", status: 503 };
    if (permission?.puede_ver !== true || permission?.puede_editar !== true) {
      return { error: "OPERATION_NOT_ALLOWED", status: 403 };
    }
  }

  return { token, userId: authData.user.id };
}

async function findAuthUserByEmail(authAdmin, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw Object.assign(new Error("AUTH_LOOKUP_FAILED"), { code: "AUTH_LOOKUP_FAILED" });
    const users = data?.users || [];
    const found = users.find((user) => normalizePortalEmail(user?.email) === email);
    if (found) return found;
    if (users.length < 1000) return null;
  }
  throw Object.assign(new Error("AUTH_LOOKUP_LIMIT_REACHED"), { code: "AUTH_LOOKUP_LIMIT_REACHED" });
}

async function hasIncompatibleAuthIdentity(authAdmin, authUser) {
  if (!authUser?.id || authUser.deleted_at || authUser.banned_until) return true;
  if (!authUser.email_confirmed_at) return true;

  const [{ data: profile, error: profileError }, { data: partner, error: partnerError }] = await Promise.all([
    authAdmin.from("profiles").select("id, role_id, active").eq("id", authUser.id).maybeSingle(),
    authAdmin.from("partner_users").select("id, active").eq("auth_user_id", authUser.id).eq("active", true).maybeSingle(),
  ]);
  if (profileError || partnerError) throw Object.assign(new Error("AUTH_IDENTITY_CHECK_FAILED"), { code: "AUTH_IDENTITY_CHECK_FAILED" });
  return Boolean(partner || (profile?.active === true && profile?.role_id));
}

async function loadControlledUnit(operatorDb, condominioId, unidadId) {
  const { data: unit, error: unitError } = await operatorDb
    .from("unidades_condominio")
    .select("id, condominio_id, activo, propietario_email")
    .eq("id", unidadId)
    .eq("condominio_id", condominioId)
    .maybeSingle();
  if (unitError) return { error: "UNIT_LOOKUP_FAILED", status: 503 };
  if (!unit || unit.activo === false) return { error: "UNIT_NOT_FOUND", status: 404 };

  const { data: control, error: controlError } = await operatorDb
    .from("condominium_operation_controls")
    .select("condominio_id, owner_portal_enabled")
    .eq("condominio_id", condominioId)
    .maybeSingle();
  if (controlError) return { error: "CONTROL_LOOKUP_FAILED", status: 503 };
  if (!control) return { error: "CONTROLLED_CONDOMINIUM_REQUIRED", status: 409 };
  return { unit, control };
}

async function handleEnable({ req, res, operatorDb, authAdmin, operator }) {
  const { condominioId, unidadId, emailConfirmed, confirmMultiUnit } = req.body || {};
  if (!condominioId || !unidadId) return response(res, 400, "INVALID_REQUEST");
  if (emailConfirmed !== true) return response(res, 400, "EMAIL_CONFIRMATION_REQUIRED");

  const scope = await loadControlledUnit(operatorDb, condominioId, unidadId);
  if (scope.error) return response(res, scope.status, scope.error);

  const email = normalizePortalEmail(scope.unit.propietario_email);
  if (!email) return response(res, 400, "EMAIL_REQUIRED");
  if (!isValidPortalEmail(email)) return response(res, 400, "INVALID_EMAIL");

  const { data: exactAccess, error: exactError } = await operatorDb
    .from("condominium_unit_portal_access")
    .select("id, condominio_id, unidad_id, email_normalized, access_kind, active, revoked_at")
    .eq("unidad_id", unidadId)
    .eq("email_normalized", email)
    .maybeSingle();
  if (exactError) return response(res, 503, "ACCESS_LOOKUP_FAILED");
  if (exactAccess && exactAccess.active === false) return response(res, 409, "REACTIVATION_REVIEW_REQUIRED");

  const [{ data: emailAccessRows, error: emailAccessError }, { data: unitAccessRows, error: unitAccessError }] = await Promise.all([
    operatorDb
      .from("condominium_unit_portal_access")
      .select("id, condominio_id, unidad_id, email_normalized, active, revoked_at")
      .eq("email_normalized", email)
      .eq("active", true)
      .is("revoked_at", null),
    operatorDb
      .from("condominium_unit_portal_access")
      .select("id, unidad_id, email_normalized, active, revoked_at")
      .eq("unidad_id", unidadId)
      .eq("active", true)
      .is("revoked_at", null),
  ]);
  if (emailAccessError || unitAccessError) return response(res, 503, "ACCESS_LOOKUP_FAILED");

  const emailActiveAccesses = activePortalAccess(emailAccessRows);
  const crossTenantAccess = emailActiveAccesses.find(
    (row) => row.condominio_id !== condominioId,
  );
  const otherEmailsOnUnit = activePortalAccess(unitAccessRows).filter((row) => normalizePortalEmail(row.email_normalized) !== email);
  if (crossTenantAccess) return response(res, 409, "AUTH_IDENTITY_REVIEW_REQUIRED");
  if (otherEmailsOnUnit.length > 0) return response(res, 409, "SHARED_EMAIL_REVIEW_REQUIRED");
  if (requiresMultiUnitConfirmation({ activeAccesses: emailActiveAccesses, unidadId, confirmMultiUnit })) {
    return response(res, 409, "MULTIUNIT_CONFIRMATION_REQUIRED", { related_units: emailActiveAccesses.length });
  }

  let authUser;
  let createdNow = false;
  try {
    authUser = await findAuthUserByEmail(authAdmin, email);
    if (authUser) {
      const recognizedPortalIdentity = Boolean(exactAccess?.active) || emailActiveAccesses.length > 0;
      if (!recognizedPortalIdentity || await hasIncompatibleAuthIdentity(authAdmin, authUser)) {
        return response(res, 409, "AUTH_IDENTITY_REVIEW_REQUIRED");
      }
    } else {
      const created = await authAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { identity_type: "condominium_owner" },
      });
      if (created.error || !created.data?.user?.id) return response(res, 503, "AUTH_CREATE_FAILED");
      authUser = created.data.user;
      createdNow = true;
      if (await hasIncompatibleAuthIdentity(authAdmin, authUser)) {
        const cleanup = await authAdmin.auth.admin.deleteUser(authUser.id);
        if (cleanup.error) console.error("condominium_portal_auth_cleanup_failed", { code: "AUTH_CLEANUP_FAILED" });
        return response(res, 409, "AUTH_IDENTITY_REVIEW_REQUIRED");
      }
    }
  } catch (error) {
    console.error("condominium_portal_auth_failed", { code: error?.code || "AUTH_OPERATION_FAILED" });
    return response(res, 503, "AUTH_OPERATION_FAILED");
  }

  if (exactAccess?.active === true && !exactAccess.revoked_at) {
    return response(res, 200, "ALREADY_ENABLED", {
      access: { id: exactAccess.id, unidad_id: exactAccess.unidad_id, active: true, access_kind: exactAccess.access_kind },
      email_masked: maskPortalEmail(email),
      portal_enabled: scope.control.owner_portal_enabled === true,
    });
  }

  const { data: inserted, error: insertError } = await operatorDb
    .from("condominium_unit_portal_access")
    .insert({
      condominio_id: condominioId,
      unidad_id: unidadId,
      email_normalized: email,
      access_kind: "OWNER",
      active: true,
      created_by: operator.userId,
      revoked_at: null,
      notes: "EMAIL_CONFIRMED_BY_ADMINISTRATION",
    })
    .select("id, condominio_id, unidad_id, access_kind, active, revoked_at")
    .single();

  if (insertError || !inserted?.id || inserted.active !== true || inserted.revoked_at) {
    if (insertError?.code === "23505") {
      const { data: concurrentAccess } = await operatorDb
        .from("condominium_unit_portal_access")
        .select("id, condominio_id, unidad_id, access_kind, active, revoked_at")
        .eq("unidad_id", unidadId)
        .eq("email_normalized", email)
        .maybeSingle();
      if (concurrentAccess?.active === true && !concurrentAccess.revoked_at) {
        return response(res, 200, "ALREADY_ENABLED", {
          access: concurrentAccess,
          email_masked: maskPortalEmail(email),
          portal_enabled: scope.control.owner_portal_enabled === true,
        });
      }
    }
    if (createdNow && authUser?.id) {
      const cleanup = await authAdmin.auth.admin.deleteUser(authUser.id);
      if (cleanup.error) console.error("condominium_portal_auth_cleanup_failed", { code: "AUTH_CLEANUP_FAILED" });
    }
    console.error("condominium_portal_relation_failed", { code: insertError?.code || "RELATION_NOT_CONFIRMED" });
    return response(res, 503, "RELATION_WRITE_FAILED");
  }

  return response(res, 200, "ENABLED", {
    access: inserted,
    email_masked: maskPortalEmail(email),
    portal_enabled: scope.control.owner_portal_enabled === true,
  });
}

async function handleRevoke({ req, res, operatorDb }) {
  const { condominioId, unidadId, accessId } = req.body || {};
  if (!condominioId || !unidadId || !accessId) return response(res, 400, "INVALID_REQUEST");

  const scope = await loadControlledUnit(operatorDb, condominioId, unidadId);
  if (scope.error) return response(res, scope.status, scope.error);

  const { data: revoked, error } = await operatorDb
    .from("condominium_unit_portal_access")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("id", accessId)
    .eq("condominio_id", condominioId)
    .eq("unidad_id", unidadId)
    .eq("active", true)
    .select("id, condominio_id, unidad_id, access_kind, active, revoked_at")
    .maybeSingle();
  if (error) return response(res, 503, "REVOCATION_FAILED");
  if (!revoked?.id) return response(res, 404, "ACTIVE_ACCESS_NOT_FOUND");
  return response(res, 200, "REVOKED", { access: revoked });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return response(res, 405, "METHOD_NOT_ALLOWED");
  if (!supabaseUrl || !anonKey || !serviceKey) return response(res, 503, "SERVICE_UNAVAILABLE");

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return response(res, 401, "SESSION_REQUIRED");
  const { operatorDb, authAdmin } = clientsForRequest(token);
  const operator = await authorizeOperator(req, authAdmin);
  if (operator.error) return response(res, operator.status, operator.error);

  try {
    if (req.body?.action === "enable") return await handleEnable({ req, res, operatorDb, authAdmin, operator });
    if (req.body?.action === "revoke") return await handleRevoke({ req, res, operatorDb });
    return response(res, 400, "INVALID_ACTION");
  } catch (error) {
    console.error("condominium_portal_access_failed", { code: error?.code || "UNEXPECTED_ERROR" });
    return response(res, 500, "UNEXPECTED_ERROR");
  }
}
