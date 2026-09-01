import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  RESERVE_FUND_EVIDENCE_BUCKET,
  decodeReserveFundEvidenceBase64,
  isReserveFundUuid,
  reserveFundContributionPublicShape,
  reserveFundErrorCode,
  reserveFundEvidencePath,
  validateReserveFundCreateInput,
} from "../../../lib/condominios/reserveFund.mjs";

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

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
  return {
    operatorDb: createClient(supabaseUrl, anonKey, {
      ...options,
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
    serviceDb: createClient(supabaseUrl, serviceKey, options),
  };
}

async function authorizeOperator(req, serviceDb) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return { error: "SESSION_REQUIRED", status: 401 };
  const token = match[1].trim();
  const { data: authData, error: authError } = await serviceDb.auth.getUser(token);
  if (authError || !authData?.user?.id) return { error: "INVALID_SESSION", status: 401 };

  const { data: profile, error: profileError } = await serviceDb
    .from("profiles")
    .select("id, role_id, active, roles:role_id(es_externo)")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return { error: "PERMISSION_CHECK_FAILED", status: 503 };
  if (!profile || profile.active === false || profile.roles?.es_externo === true) {
    return { error: "OPERATION_NOT_ALLOWED", status: 403 };
  }
  if (profile.role_id !== "admin") {
    const { data: permission, error: permissionError } = await serviceDb
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

async function loadScopedContribution(operatorDb, { contributionId, condominioId, unidadId }) {
  if (![contributionId, condominioId, unidadId].every(isReserveFundUuid)) {
    return { error: "INVALID_SCOPE", status: 400 };
  }
  const { data, error } = await operatorDb
    .from("condominium_reserve_fund_contributions")
    .select("*")
    .eq("id", contributionId)
    .eq("condominio_id", condominioId)
    .eq("unidad_id", unidadId)
    .maybeSingle();
  if (error) return { error: "CONTRIBUTION_LOOKUP_FAILED", status: 503 };
  if (!data) return { error: "CONTRIBUTION_NOT_FOUND", status: 404 };
  return { data };
}

async function validateCreateScope(operatorDb, { condominioId, unidadId }) {
  const { data, error } = await operatorDb
    .from("unidades_condominio")
    .select("id, condominio_id, activo")
    .eq("id", unidadId)
    .eq("condominio_id", condominioId)
    .eq("activo", true)
    .maybeSingle();
  if (error) return { error: "SCOPE_LOOKUP_FAILED", status: 503 };
  if (!data) return { error: "UNIT_NOT_FOUND", status: 404 };
  return { data };
}

async function createContribution({ req, res, operatorDb, serviceDb }) {
  const inputError = validateReserveFundCreateInput(req.body);
  if (inputError) return response(res, 400, inputError);

  const {
    condominioId, unidadId, amount, sourceOrganization, paymentReference,
    proofDate, idempotencyKey, evidence,
  } = req.body;
  const scope = await validateCreateScope(operatorDb, req.body);
  if (scope.error) return response(res, scope.status, scope.error);

  const contributionId = idempotencyKey;
  const evidencePath = reserveFundEvidencePath({
    condominioId,
    unidadId,
    contributionId,
    mimeType: evidence.mimeType,
  });
  const bytes = decodeReserveFundEvidenceBase64(evidence.base64);
  if (!evidencePath || !bytes) return response(res, 400, "INVALID_EVIDENCE");
  const evidenceSha256 = createHash("sha256").update(bytes).digest("hex");

  let uploadedNow = false;
  const upload = await serviceDb.storage
    .from(RESERVE_FUND_EVIDENCE_BUCKET)
    .upload(evidencePath, bytes, { contentType: evidence.mimeType, upsert: false });
  if (upload.error) {
    const alreadyExists = String(upload.error.message || "").toLowerCase().includes("already exists");
    if (!alreadyExists) {
      console.error("reserve_fund_evidence_upload_failed", { code: "EVIDENCE_UPLOAD_FAILED" });
      return response(res, 503, "EVIDENCE_UPLOAD_FAILED");
    }
  } else {
    uploadedNow = true;
  }

  const { data, error } = await operatorDb.rpc("condominium_create_reserve_fund_contribution", {
    p_contribution_id: contributionId,
    p_condominio_id: condominioId,
    p_unidad_id: unidadId,
    p_amount: Number(amount),
    p_source_organization: String(sourceOrganization).trim(),
    p_proof_date: proofDate,
    p_payment_reference: String(paymentReference).trim(),
    p_evidence_path: evidencePath,
    p_evidence_sha256: evidenceSha256,
    p_idempotency_key: idempotencyKey,
  });
  if (error || !data?.id) {
    if (uploadedNow) await serviceDb.storage.from(RESERVE_FUND_EVIDENCE_BUCKET).remove([evidencePath]);
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_create_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_PENDING", {
    contribution: reserveFundContributionPublicShape(data),
  });
}

async function reconcileContribution({ req, res, operatorDb }) {
  const scope = await loadScopedContribution(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const depositDate = String(req.body?.depositDate || "");
  const bankConfirmedBy = String(req.body?.bankConfirmedBy || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depositDate) || Number.isNaN(Date.parse(`${depositDate}T00:00:00Z`))) {
    return response(res, 400, "INVALID_DEPOSIT_DATE");
  }
  if (bankConfirmedBy.length < 2) return response(res, 400, "INVALID_BANK_CONFIRMATION");
  const { data, error } = await operatorDb.rpc("condominium_reconcile_reserve_fund_contribution", {
    p_contribution_id: scope.data.id,
    p_deposit_date: depositDate,
    p_bank_confirmed_by: bankConfirmedBy,
  });
  if (error || !data?.id || data.status !== "reconciled") {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_reconcile_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_RECONCILED", {
    contribution: reserveFundContributionPublicShape(data),
  });
}

async function reverseContribution({ req, res, operatorDb }) {
  const scope = await loadScopedContribution(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5) return response(res, 400, "REVERSAL_REASON_REQUIRED");
  const { data, error } = await operatorDb.rpc("condominium_reverse_reserve_fund_contribution", {
    p_contribution_id: scope.data.id,
    p_reason: reason,
  });
  if (error || !data?.id || data.status !== "reversed") {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_reverse_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_REVERSED", {
    contribution: reserveFundContributionPublicShape(data),
  });
}

async function viewEvidence({ req, res, operatorDb, serviceDb }) {
  const scope = await loadScopedContribution(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  if (!scope.data.evidence_path) return response(res, 404, "EVIDENCE_NOT_FOUND");
  const { data, error } = await serviceDb.storage
    .from(RESERVE_FUND_EVIDENCE_BUCKET)
    .createSignedUrl(scope.data.evidence_path, 60);
  if (error || !data?.signedUrl) return response(res, 503, "EVIDENCE_ACCESS_FAILED");
  return response(res, 200, "EVIDENCE_URL_CREATED", { signedUrl: data.signedUrl, expiresIn: 60 });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return response(res, 405, "METHOD_NOT_ALLOWED");
  if (!supabaseUrl || !anonKey || !serviceKey) return response(res, 503, "SERVICE_UNAVAILABLE");

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return response(res, 401, "SESSION_REQUIRED");
  const { operatorDb, serviceDb } = clientsForRequest(token);
  const operator = await authorizeOperator(req, serviceDb);
  if (operator.error) return response(res, operator.status, operator.error);

  try {
    if (req.body?.action === "create") return await createContribution({ req, res, operatorDb, serviceDb });
    if (req.body?.action === "reconcile") return await reconcileContribution({ req, res, operatorDb });
    if (req.body?.action === "reverse") return await reverseContribution({ req, res, operatorDb });
    if (req.body?.action === "evidence") return await viewEvidence({ req, res, operatorDb, serviceDb });
    return response(res, 400, "INVALID_ACTION");
  } catch (error) {
    console.error("reserve_fund_endpoint_failed", { code: error?.code || "UNEXPECTED_ERROR" });
    return response(res, 500, "UNEXPECTED_ERROR");
  }
}
