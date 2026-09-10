import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { INCIDENT_EVIDENCE_BUCKET, incidentErrorCode, incidentEvidencePath, validateIncidentEvidence, validateIncidentInput, isUuid } from "../../../lib/condominios/incidents.mjs";

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reply = (res, status, code, extra = {}) => res.status(status).json({ ok: status < 300, code, ...extra });

function clients(token) {
  const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
  return {
    userDb: createClient(url, anon, { auth, global: { headers: { Authorization: `Bearer ${token}` } } }),
    serviceDb: createClient(url, secret, { auth }),
  };
}

async function identity(req, serviceDb) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { status: 401, code: "SESSION_REQUIRED" };
  const { data, error } = await serviceDb.auth.getUser(token);
  if (error || !data?.user?.id) return { status: 401, code: "INVALID_SESSION" };
  const { data: profile } = await serviceDb.from("profiles").select("id,role_id,active,roles:role_id(es_externo)").eq("id", data.user.id).maybeSingle();
  if (!profile?.active) return { status: 403, code: "OPERATION_NOT_ALLOWED" };
  const external = profile.roles?.es_externo === true;
  return { token, userId: data.user.id, profile, external };
}

async function internalPermission(serviceDb, actor, edit) {
  if (actor.external) return false;
  if (actor.profile.role_id === "admin") return true;
  const { data } = await serviceDb.from("permisos_modulo").select("puede_ver,puede_editar").eq("role_id", actor.profile.role_id).eq("modulo", "condominios").maybeSingle();
  return data?.puede_ver === true && (!edit || data?.puede_editar === true);
}

async function uploadEvidence(serviceDb, scope, evidence) {
  if (!evidence) return null;
  const invalid = validateIncidentEvidence(evidence);
  if (invalid) throw Object.assign(new Error(invalid), { publicCode: invalid });
  const evidenceId = randomUUID();
  const path = incidentEvidencePath({ ...scope, evidenceId, mimeType: evidence.mimeType });
  const bytes = Buffer.from(evidence.base64, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { error } = await serviceDb.storage.from(INCIDENT_EVIDENCE_BUCKET).upload(path, bytes, { contentType: evidence.mimeType, upsert: false });
  if (error) throw Object.assign(new Error("EVIDENCE_UPLOAD_FAILED"), { publicCode: "EVIDENCE_UPLOAD_FAILED" });
  return { evidenceId, path, sha256, mimeType: evidence.mimeType, sizeBytes: bytes.length };
}

async function list(req, res, userDb) {
  const condominioId = String(req.body?.condominioId || "");
  const unidadId = req.body?.unidadId || null;
  if (!isUuid(condominioId) || (unidadId && !isUuid(unidadId))) return reply(res, 400, "INVALID_SCOPE");
  let query = userDb.from("maintenance_tickets").select("id,condominio_id,unidad_id,title,description,category,priority,status,incident_origin,resolution_summary,created_at,updated_at,first_attended_at,resolved_at,closed_at,reopened_at,legacy_record,maintenance_ticket_updates(id,visibility,body,from_status,to_status,created_at),maintenance_ticket_evidence(id,mime_type,size_bytes,created_at)").eq("condominio_id", condominioId).eq("legacy_record", false).order("created_at", { ascending: false });
  if (unidadId) query = query.eq("unidad_id", unidadId);
  const { data, error } = await query;
  if (error) return reply(res, 403, "OPERATION_NOT_ALLOWED");
  const { data: categories } = await userDb.from("maintenance_categories").select("id,code,name,sort_order").eq("condominio_id", condominioId).eq("active", true).order("sort_order");
  return reply(res, 200, "INCIDENTS_LOADED", { incidents: data || [], categories: categories || [] });
}

async function create(req, res, userDb, serviceDb, actor) {
  const errorCode = validateIncidentInput(req.body);
  if (errorCode) return reply(res, 400, errorCode);
  const evidence = await uploadEvidence(serviceDb, { condominioId: req.body.condominioId, ticketId: req.body.idempotencyKey }, req.body.evidence);
  const { data, error } = await userDb.rpc("condominium_create_incident_v1", {
    p_ticket_id: req.body.idempotencyKey, p_condominio_id: req.body.condominioId, p_unidad_id: req.body.unidadId,
    p_category_id: req.body.categoryId || null, p_title: String(req.body.title).trim(), p_description: String(req.body.description).trim(), p_priority: req.body.priority || "media",
    p_origin: actor.external ? "resident_portal" : "administration", p_idempotency_key: req.body.idempotencyKey,
    p_evidence_id: evidence?.evidenceId || null, p_evidence_path: evidence?.path || null, p_evidence_sha256: evidence?.sha256 || null,
    p_evidence_mime_type: evidence?.mimeType || null, p_evidence_size_bytes: evidence?.sizeBytes || null,
  });
  if (error || !data?.id) {
    if (evidence) await serviceDb.storage.from(INCIDENT_EVIDENCE_BUCKET).remove([evidence.path]);
    return reply(res, 409, incidentErrorCode(error));
  }
  return reply(res, 200, "INCIDENT_CREATED", { incident: data });
}

async function update(req, res, userDb, serviceDb, actor) {
  if (!await internalPermission(serviceDb, actor, true)) return reply(res, 403, "OPERATION_NOT_ALLOWED");
  if (![req.body.ticketId, req.body.condominioId].every(isUuid)) return reply(res, 400, "INVALID_SCOPE");
  const { data, error } = await userDb.rpc("condominium_update_incident_v1", {
    p_ticket_id: req.body.ticketId, p_condominio_id: req.body.condominioId, p_status: req.body.status || null,
    p_priority: req.body.priority || null, p_responsible_profile_id: req.body.responsibleProfileId || null,
    p_message: String(req.body.message || "").trim() || null, p_visibility: req.body.visibility || "internal",
    p_resolution_summary: String(req.body.resolutionSummary || "").trim() || null,
  });
  if (error || !data?.id) return reply(res, 409, incidentErrorCode(error));
  return reply(res, 200, "INCIDENT_UPDATED", { incident: data });
}

async function evidenceUrl(req, res, userDb, serviceDb) {
  if (![req.body.evidenceId, req.body.ticketId, req.body.condominioId].every(isUuid)) return reply(res, 400, "INVALID_SCOPE");
  const { data: row, error } = await userDb.from("maintenance_ticket_evidence").select("storage_path").eq("id", req.body.evidenceId).eq("ticket_id", req.body.ticketId).eq("condominio_id", req.body.condominioId).maybeSingle();
  if (error || !row) return reply(res, 403, "OPERATION_NOT_ALLOWED");
  const { data, error: signError } = await serviceDb.storage.from(INCIDENT_EVIDENCE_BUCKET).createSignedUrl(row.storage_path, 60);
  if (signError || !data?.signedUrl) return reply(res, 503, "EVIDENCE_ACCESS_FAILED");
  return reply(res, 200, "EVIDENCE_URL_CREATED", { signedUrl: data.signedUrl, expiresIn: 60 });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, "METHOD_NOT_ALLOWED");
  if (!url || !anon || !secret) return reply(res, 503, "SERVICE_UNAVAILABLE");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const { userDb, serviceDb } = clients(token);
  const actor = await identity(req, serviceDb);
  if (actor.code) return reply(res, actor.status, actor.code);
  try {
    if (req.body?.action === "list") return await list(req, res, userDb);
    if (req.body?.action === "create") return await create(req, res, userDb, serviceDb, actor);
    if (req.body?.action === "update") return await update(req, res, userDb, serviceDb, actor);
    if (req.body?.action === "evidence") return await evidenceUrl(req, res, userDb, serviceDb);
    return reply(res, 400, "INVALID_ACTION");
  } catch (error) {
    console.error("condominium_incident_v1_failed", { code: error.publicCode || "UNEXPECTED_ERROR" });
    return reply(res, error.publicCode ? 400 : 500, error.publicCode || "UNEXPECTED_ERROR");
  }
}
