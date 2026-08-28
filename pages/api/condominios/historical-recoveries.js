import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  HISTORICAL_EVIDENCE_BUCKET,
  decodeEvidenceBase64,
  historicalEvidencePath,
  historicalRecoveryErrorCode,
  isUuid,
  recoveryPublicShape,
  validateRecoveryCreateInput,
} from "../../../lib/condominios/historicalRecovery.mjs";

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

async function loadScopedRecovery(operatorDb, { recoveryId, condominioId, unidadId }) {
  if (![recoveryId, condominioId, unidadId].every(isUuid)) return { error: "INVALID_SCOPE", status: 400 };
  const { data, error } = await operatorDb
    .from("condominium_historical_recoveries")
    .select("*")
    .eq("id", recoveryId)
    .eq("condominio_id", condominioId)
    .eq("unidad_id", unidadId)
    .maybeSingle();
  if (error) return { error: "RECOVERY_LOOKUP_FAILED", status: 503 };
  if (!data) return { error: "RECOVERY_NOT_FOUND", status: 404 };
  return { data };
}

async function validateCreateScope(operatorDb, payload) {
  const { condominioId, unidadId, historicalAccountId, currentFeeId } = payload;
  const { data: account, error: accountError } = await operatorDb
    .from("condominium_historical_accounts")
    .select("id, condominio_id, unidad_id, reported_balance")
    .eq("id", historicalAccountId)
    .eq("condominio_id", condominioId)
    .eq("unidad_id", unidadId)
    .maybeSingle();
  if (accountError) return { error: "SCOPE_LOOKUP_FAILED", status: 503 };
  if (!account) return { error: "HISTORICAL_ACCOUNT_NOT_FOUND", status: 404 };

  const { data: applied, error: recoveryError } = await operatorDb
    .from("condominium_historical_recoveries")
    .select("amount")
    .eq("historical_account_id", historicalAccountId)
    .eq("status", "APLICADO");
  if (recoveryError) return { error: "SCOPE_LOOKUP_FAILED", status: 503 };
  const historicalPending = Math.max(0, Number(account.reported_balance || 0) - (applied || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  if (Number(payload.amount) > historicalPending) return { error: "HISTORICAL_BALANCE_EXCEEDED", status: 409 };

  if (!currentFeeId) {
    if (Number(payload.depositTotal) !== Number(payload.amount)) return { error: "INVALID_DEPOSIT_TOTAL", status: 400 };
    return { account };
  }
  const { data: fee, error: feeError } = await operatorDb
    .from("cuotas_condominio")
    .select("id, condominio_id, unidad_id, monto, status")
    .eq("id", currentFeeId)
    .eq("condominio_id", condominioId)
    .eq("unidad_id", unidadId)
    .maybeSingle();
  if (feeError) return { error: "SCOPE_LOOKUP_FAILED", status: 503 };
  if (!fee || fee.status === "pagado") return { error: "CURRENT_FEE_NOT_APPLICABLE", status: 409 };
  if (Number(payload.depositTotal) !== Number(payload.amount) + Number(fee.monto)) {
    return { error: "INVALID_DEPOSIT_TOTAL", status: 400 };
  }
  return { account, fee };
}

async function createRecovery({ req, res, operatorDb, serviceDb }) {
  const inputError = validateRecoveryCreateInput(req.body);
  if (inputError) return response(res, 400, inputError);

  const {
    condominioId, unidadId, historicalAccountId, amount, depositTotal,
    paymentReference, proofReceivedAt, idempotencyKey, currentFeeId, evidence,
  } = req.body;
  const scope = await validateCreateScope(operatorDb, req.body);
  if (scope.error) return response(res, scope.status, scope.error);
  const recoveryId = idempotencyKey;
  const evidencePath = historicalEvidencePath({
    condominioId,
    unidadId,
    recoveryId,
    mimeType: evidence.mimeType,
  });
  const bytes = decodeEvidenceBase64(evidence.base64);
  if (!evidencePath || !bytes) return response(res, 400, "INVALID_EVIDENCE");
  const evidenceSha256 = createHash("sha256").update(bytes).digest("hex");

  let uploadedNow = false;
  const upload = await serviceDb.storage
    .from(HISTORICAL_EVIDENCE_BUCKET)
    .upload(evidencePath, bytes, { contentType: evidence.mimeType, upsert: false });
  if (upload.error) {
    const alreadyExists = String(upload.error.message || "").toLowerCase().includes("already exists");
    if (!alreadyExists) {
      console.error("historical_recovery_evidence_upload_failed", { code: "EVIDENCE_UPLOAD_FAILED" });
      return response(res, 503, "EVIDENCE_UPLOAD_FAILED");
    }
  } else {
    uploadedNow = true;
  }

  const { data, error } = await operatorDb.rpc("condominium_create_historical_recovery", {
    p_recovery_id: recoveryId,
    p_condominio_id: condominioId,
    p_unidad_id: unidadId,
    p_historical_account_id: historicalAccountId,
    p_amount: Number(amount),
    p_deposit_total: Number(depositTotal),
    p_payment_reference: String(paymentReference).trim(),
    p_proof_received_at: proofReceivedAt,
    p_evidence_path: evidencePath,
    p_evidence_sha256: evidenceSha256,
    p_idempotency_key: idempotencyKey,
    p_current_fee_id: currentFeeId || null,
  });
  if (error || !data?.id) {
    if (uploadedNow) await serviceDb.storage.from(HISTORICAL_EVIDENCE_BUCKET).remove([evidencePath]);
    const code = historicalRecoveryErrorCode(error);
    console.error("historical_recovery_create_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RECOVERY_PENDING", { recovery: recoveryPublicShape(data) });
}

async function applyRecovery({ req, res, operatorDb }) {
  const scope = await loadScopedRecovery(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const { collectedAt, bankConfirmationReference } = req.body;
  if (!collectedAt || Number.isNaN(Date.parse(collectedAt)) || String(bankConfirmationReference || "").trim().length < 2) {
    return response(res, 400, "INVALID_BANK_CONFIRMATION");
  }
  const { data, error } = await operatorDb.rpc("condominium_apply_historical_recovery", {
    p_recovery_id: scope.data.id,
    p_collected_at: collectedAt,
    p_bank_confirmation_reference: String(bankConfirmationReference).trim(),
  });
  if (error || !data?.id || data.status !== "APLICADO") {
    const code = historicalRecoveryErrorCode(error);
    console.error("historical_recovery_apply_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RECOVERY_APPLIED", { recovery: recoveryPublicShape(data) });
}

async function reverseRecovery({ req, res, operatorDb }) {
  const scope = await loadScopedRecovery(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5) return response(res, 400, "REVERSAL_REASON_REQUIRED");
  const { data, error } = await operatorDb.rpc("condominium_reverse_historical_recovery", {
    p_recovery_id: scope.data.id,
    p_reason: reason,
  });
  if (error || !data?.id || data.status !== "REVERSADO") {
    const code = historicalRecoveryErrorCode(error);
    console.error("historical_recovery_reverse_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RECOVERY_REVERSED", { recovery: recoveryPublicShape(data) });
}

async function viewEvidence({ req, res, operatorDb, serviceDb }) {
  const scope = await loadScopedRecovery(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  if (!scope.data.evidence_path) return response(res, 404, "EVIDENCE_NOT_FOUND");
  const { data, error } = await serviceDb.storage
    .from(HISTORICAL_EVIDENCE_BUCKET)
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
    if (req.body?.action === "create") return await createRecovery({ req, res, operatorDb, serviceDb });
    if (req.body?.action === "apply") return await applyRecovery({ req, res, operatorDb });
    if (req.body?.action === "reverse") return await reverseRecovery({ req, res, operatorDb });
    if (req.body?.action === "evidence") return await viewEvidence({ req, res, operatorDb, serviceDb });
    return response(res, 400, "INVALID_ACTION");
  } catch (error) {
    console.error("historical_recovery_endpoint_failed", { code: error?.code || "UNEXPECTED_ERROR" });
    return response(res, 500, "UNEXPECTED_ERROR");
  }
}
