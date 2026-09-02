import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  RESERVE_FUND_EVIDENCE_BUCKET,
  decodeReserveFundEvidenceBase64,
  isReserveFundUuid,
  reserveFundReceiptPublicShape,
  reserveFundErrorCode,
  reserveFundEvidencePath,
  validateReserveFundAntiveBatchInput,
  validateReserveFundCreateInput,
  validateReserveFundEvidenceEnrichmentInput,
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

async function loadScopedReceipt(operatorDb, { receiptId, condominioId }) {
  if (![receiptId, condominioId].every(isReserveFundUuid)) {
    return { error: "INVALID_SCOPE", status: 400 };
  }
  const { data, error } = await operatorDb
    .from("condominium_reserve_fund_receipts")
    .select("*, contributions:condominium_reserve_fund_contributions(id, unidad_id, amount)")
    .eq("id", receiptId)
    .eq("condominio_id", condominioId)
    .maybeSingle();
  if (error) return { error: "RECEIPT_LOOKUP_FAILED", status: 503 };
  if (!data) return { error: "RECEIPT_NOT_FOUND", status: 404 };
  return { data };
}

async function validateCreateScope(operatorDb, { condominioId, allocations }) {
  const unitIds = allocations.map(allocation => allocation.unidadId);
  const { data, error } = await operatorDb
    .from("unidades_condominio")
    .select("id, condominio_id, activo")
    .in("id", unitIds)
    .eq("condominio_id", condominioId)
    .eq("activo", true)
    ;
  if (error) return { error: "SCOPE_LOOKUP_FAILED", status: 503 };
  if (!Array.isArray(data) || data.length !== unitIds.length) return { error: "UNIT_NOT_FOUND", status: 404 };
  return { data };
}

async function createContribution({ req, res, operatorDb, serviceDb }) {
  const inputError = validateReserveFundCreateInput(req.body);
  if (inputError) return response(res, 400, inputError);

  const {
    condominioId, allocations, sourceOrganization, paymentReference,
    proofDate, idempotencyKey, evidence,
  } = req.body;
  const scope = await validateCreateScope(operatorDb, req.body);
  if (scope.error) return response(res, scope.status, scope.error);

  const receiptId = idempotencyKey;
  const evidencePath = reserveFundEvidencePath({
    condominioId,
    receiptId,
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
    const { data: existingReceipt, error: existingReceiptError } = await serviceDb
      .from("condominium_reserve_fund_receipts")
      .select("id, condominio_id, evidence_sha256, idempotency_key")
      .eq("id", receiptId)
      .eq("condominio_id", condominioId)
      .maybeSingle();
    if (existingReceiptError || !existingReceipt
        || existingReceipt.evidence_sha256 !== evidenceSha256
        || existingReceipt.idempotency_key !== idempotencyKey) {
      return response(res, 409, "EVIDENCE_CONFLICT");
    }
  } else {
    uploadedNow = true;
  }

  const { data, error } = await operatorDb.rpc("condominium_create_reserve_fund_receipt", {
    p_receipt_id: receiptId,
    p_condominio_id: condominioId,
    p_allocations: allocations.map(allocation => ({
      unidad_id: allocation.unidadId,
      amount: Number(allocation.amount),
    })),
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
  const scoped = await loadScopedReceipt(operatorDb, { receiptId: data.id, condominioId });
  if (scoped.error) return response(res, scoped.status, scoped.error);
  return response(res, 200, "RESERVE_FUND_PENDING", {
    receipt: reserveFundReceiptPublicShape(scoped.data),
  });
}

async function importAntiveReceivedBatch({ req, res, operatorDb }) {
  const inputError = validateReserveFundAntiveBatchInput(req.body);
  if (inputError) return response(res, 400, inputError);
  const scope = await validateCreateScope(operatorDb, {
    condominioId: req.body.condominioId,
    allocations: req.body.records.map(record => ({ unidadId: record.unidadId })),
  });
  if (scope.error) return response(res, scope.status, scope.error);

  const { data: batch, error } = await operatorDb.rpc("condominium_import_antive_reserve_fund_batch", {
    p_batch_id: req.body.batchId,
    p_condominio_id: req.body.condominioId,
    p_source_file_sha256: String(req.body.sourceFileSha256).toLowerCase(),
    p_source_sheet: String(req.body.sourceSheet).trim(),
    p_records: req.body.records.map(record => ({
      receipt_id: record.receiptId,
      unidad_id: record.unidadId,
      amount: Number(record.amount),
      source_range: String(record.sourceRange).trim().toUpperCase(),
      idempotency_key: record.idempotencyKey,
    })),
    p_received_confirmed_by: String(req.body.receivedConfirmedBy).trim(),
    p_received_confirmed_at: req.body.receivedConfirmedAt,
    p_received_confirmation_note: String(req.body.receivedConfirmationNote || "").trim() || null,
  });
  if (error || !batch?.id) {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_antive_batch_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  const { data: receipts, error: receiptsError } = await operatorDb
    .from("condominium_reserve_fund_receipts")
    .select("*, contributions:condominium_reserve_fund_contributions(id, unidad_id, amount)")
    .eq("condominio_id", req.body.condominioId)
    .eq("import_batch_id", batch.id)
    .order("source_range");
  if (receiptsError) return response(res, 503, "RECEIPT_LOOKUP_FAILED");
  return response(res, 200, "RESERVE_FUND_ANTIVE_RECEIVED", {
    batch: { id: batch.id, status: batch.status, recordCount: receipts.length },
    receipts: receipts.map(reserveFundReceiptPublicShape),
  });
}

async function enrichAntiveEvidence({ req, res, operatorDb, serviceDb }) {
  const inputError = validateReserveFundEvidenceEnrichmentInput(req.body);
  if (inputError) return response(res, 400, inputError);
  const scope = await loadScopedReceipt(operatorDb, req.body);
  if (scope.error) return response(res, scope.status, scope.error);

  const evidencePath = reserveFundEvidencePath({
    condominioId: req.body.condominioId,
    receiptId: req.body.receiptId,
    mimeType: req.body.evidence.mimeType,
  });
  const bytes = decodeReserveFundEvidenceBase64(req.body.evidence.base64);
  if (!evidencePath || !bytes) return response(res, 400, "INVALID_EVIDENCE");
  const evidenceSha256 = createHash("sha256").update(bytes).digest("hex");

  let uploadedNow = false;
  const upload = await serviceDb.storage
    .from(RESERVE_FUND_EVIDENCE_BUCKET)
    .upload(evidencePath, bytes, { contentType: req.body.evidence.mimeType, upsert: false });
  if (upload.error) {
    const alreadyExists = String(upload.error.message || "").toLowerCase().includes("already exists");
    if (!alreadyExists
        || scope.data.evidence_path !== evidencePath
        || scope.data.evidence_sha256 !== evidenceSha256) {
      return response(res, alreadyExists ? 409 : 503, alreadyExists ? "EVIDENCE_CONFLICT" : "EVIDENCE_UPLOAD_FAILED");
    }
  } else {
    uploadedNow = true;
  }

  const { data, error } = await operatorDb.rpc("condominium_enrich_reserve_fund_receipt_evidence", {
    p_receipt_id: req.body.receiptId,
    p_proof_date: req.body.proofDate,
    p_payment_reference: String(req.body.paymentReference).trim(),
    p_evidence_path: evidencePath,
    p_evidence_sha256: evidenceSha256,
  });
  if (error || !data?.id) {
    if (uploadedNow) await serviceDb.storage.from(RESERVE_FUND_EVIDENCE_BUCKET).remove([evidencePath]);
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_evidence_enrichment_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_EVIDENCE_ENRICHED", {
    receipt: reserveFundReceiptPublicShape({ ...data, contributions: scope.data.contributions }),
  });
}

async function reconcileReceipt({ req, res, operatorDb }) {
  const scope = await loadScopedReceipt(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const depositDate = String(req.body?.depositDate || "");
  const bankConfirmedBy = String(req.body?.bankConfirmedBy || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depositDate) || Number.isNaN(Date.parse(`${depositDate}T00:00:00Z`))) {
    return response(res, 400, "INVALID_DEPOSIT_DATE");
  }
  if (bankConfirmedBy.length < 2) return response(res, 400, "INVALID_BANK_CONFIRMATION");
  const { data, error } = await operatorDb.rpc("condominium_reconcile_reserve_fund_receipt", {
    p_receipt_id: scope.data.id,
    p_deposit_date: depositDate,
    p_bank_confirmed_by: bankConfirmedBy,
  });
  if (error || !data?.id || data.status !== "reconciled") {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_reconcile_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_RECONCILED", {
    receipt: reserveFundReceiptPublicShape({ ...data, contributions: scope.data.contributions }),
  });
}

async function reverseReceipt({ req, res, operatorDb }) {
  const scope = await loadScopedReceipt(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5) return response(res, 400, "REVERSAL_REASON_REQUIRED");
  const { data, error } = await operatorDb.rpc("condominium_reverse_reserve_fund_receipt", {
    p_receipt_id: scope.data.id,
    p_reason: reason,
  });
  if (error || !data?.id || data.status !== "reversed") {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_reverse_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_REVERSED", {
    receipt: reserveFundReceiptPublicShape({ ...data, contributions: scope.data.contributions }),
  });
}

async function voidReceipt({ req, res, operatorDb }) {
  const scope = await loadScopedReceipt(operatorDb, req.body || {});
  if (scope.error) return response(res, scope.status, scope.error);
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5) return response(res, 400, "VOID_REASON_REQUIRED");
  const { data, error } = await operatorDb.rpc("condominium_void_reserve_fund_receipt", {
    p_receipt_id: scope.data.id,
    p_reason: reason,
  });
  if (error || !data?.id || data.status !== "voided") {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_void_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_VOIDED", {
    receipt: reserveFundReceiptPublicShape({ ...data, contributions: scope.data.contributions }),
  });
}

async function voidBatch({ req, res, operatorDb }) {
  if (![req.body?.batchId, req.body?.condominioId].every(isReserveFundUuid)) {
    return response(res, 400, "INVALID_SCOPE");
  }
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 5) return response(res, 400, "VOID_REASON_REQUIRED");
  const { data: scopedBatch, error: scopedBatchError } = await operatorDb
    .from("condominium_reserve_fund_import_batches")
    .select("id, condominio_id, status")
    .eq("id", req.body.batchId)
    .eq("condominio_id", req.body.condominioId)
    .maybeSingle();
  if (scopedBatchError) return response(res, 503, "BATCH_LOOKUP_FAILED");
  if (!scopedBatch) return response(res, 404, "BATCH_NOT_FOUND");
  const { data, error } = await operatorDb.rpc("condominium_void_reserve_fund_batch", {
    p_batch_id: scopedBatch.id,
    p_reason: reason,
  });
  if (error || !data?.id || data.status !== "voided") {
    const code = reserveFundErrorCode(error);
    console.error("reserve_fund_batch_void_failed", { code });
    return response(res, code === "OPERATION_NOT_ALLOWED" ? 403 : 409, code);
  }
  return response(res, 200, "RESERVE_FUND_BATCH_VOIDED", {
    batch: { id: data.id, status: data.status },
  });
}

async function viewEvidence({ req, res, operatorDb, serviceDb }) {
  const scope = await loadScopedReceipt(operatorDb, req.body || {});
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
    if (req.body?.action === "import-antive-received") return await importAntiveReceivedBatch({ req, res, operatorDb });
    if (req.body?.action === "enrich-evidence") return await enrichAntiveEvidence({ req, res, operatorDb, serviceDb });
    if (req.body?.action === "reconcile") return await reconcileReceipt({ req, res, operatorDb });
    if (req.body?.action === "reverse") return await reverseReceipt({ req, res, operatorDb });
    if (req.body?.action === "void") return await voidReceipt({ req, res, operatorDb });
    if (req.body?.action === "void-batch") return await voidBatch({ req, res, operatorDb });
    if (req.body?.action === "evidence") return await viewEvidence({ req, res, operatorDb, serviceDb });
    return response(res, 400, "INVALID_ACTION");
  } catch (error) {
    console.error("reserve_fund_endpoint_failed", { code: error?.code || "UNEXPECTED_ERROR" });
    return response(res, 500, "UNEXPECTED_ERROR");
  }
}
