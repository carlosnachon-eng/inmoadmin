import {
  resolveRespondProfile,
  toIsoFromRespondTimestamp,
} from "./workCenter";

export const RESPOND_BASE = "https://api.respond.io/v2";
export const RESPOND_MESSAGE_PAGE_LIMIT = 50;
export const RESPOND_MAX_MESSAGE_PAGES_PER_CONTACT = 3;
const RESPOND_MIN_INTERVAL_MS = 250;
const RESPOND_REQUEST_TIMEOUT_MS = 30_000;

let lastRespondRequestAt = 0;

const normalize = (value) => String(value || "").trim().toLowerCase();

export function isRespondIncrementalWebhooksEnabled() {
  return normalize(process.env.RESPOND_INCREMENTAL_WEBHOOKS_ENABLED) === "true";
}

export function isRespondIncrementalWorkerEnabled() {
  return normalize(process.env.RESPOND_INCREMENTAL_WORKER_ENABLED) === "true";
}

export function assertRespondIncrementalWebhooksEnabled() {
  if (!isRespondIncrementalWebhooksEnabled()) {
    const error = new Error("Respond incremental webhooks no habilitado.");
    error.statusCode = 404;
    throw error;
  }
}

export function assertRespondIncrementalWorkerEnabled() {
  if (!isRespondIncrementalWorkerEnabled()) {
    const error = new Error("Respond incremental worker no habilitado.");
    error.statusCode = 404;
    throw error;
  }
}

export async function respondRequest(path, { method = "GET", body, params } = {}) {
  const token = process.env.RESPOND_IO_TOKEN || process.env.RESPOND_IO_API_TOKEN;
  if (!token) throw new Error("Falta RESPOND_IO_TOKEN.");

  const now = Date.now();
  const wait = Math.max(0, RESPOND_MIN_INTERVAL_MS - (now - lastRespondRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRespondRequestAt = Date.now();

  const url = new URL(String(path).startsWith("http") ? path : `${RESPOND_BASE}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESPOND_REQUEST_TIMEOUT_MS);
    let response;
    let text;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      if (err?.name === "AbortError") {
        const timeoutError = new Error("Respond.io request timeout.");
        timeoutError.public = { status: 504, code: "respond_timeout", message: "Respond.io request timeout." };
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After") || 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfter * 1000)));
      continue;
    }
    if (!response.ok) {
      const error = new Error(`Respond.io ${response.status}`);
      error.public = { status: response.status, code: json?.code, message: json?.message };
      throw error;
    }
    return json;
  }

  throw new Error("Respond.io rate limit retry agotado.");
}

export const respondItems = (body) => (
  Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []
);

export const respondPaginationNext = (body) => body?.pagination?.next || null;

function customValue(contact, slug) {
  const field = (contact?.custom_fields || []).find(
    (candidate) => normalize(candidate.slug || candidate.name || candidate.fieldId) === slug
  );
  const value = field?.value;
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function parseDateField(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseNumberField(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function contactDisplayName(contact) {
  const pieces = [contact?.firstName, contact?.lastName].filter(Boolean);
  return contact?.name || contact?.fullName || (pieces.length ? pieces.join(" ") : null);
}

function metadataWithoutContactPii(metadata) {
  const allowedKeys = new Set([
    "mapping_method",
    "sync_mode",
    "message_pages_read",
    "fields_present",
    "classification",
    "classifier_version",
    "classification_reason_codes",
    "respond_lookup",
    "unanswered_state",
  ]);
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([key]) => allowedKeys.has(key))
  );
}

function isoFromUnknownTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return toIsoFromRespondTimestamp(number < 1e11 ? number * 1000 : number);
}

export function respondMessageTimestamp(message) {
  const direct = isoFromUnknownTimestamp(
    message?.timestamp || message?.created_at || message?.createdAt || message?.sentAt
  );
  if (direct) return direct;
  if (message?.messageId) return toIsoFromRespondTimestamp(message.messageId);
  const statusTimestamp = Array.isArray(message?.status)
    ? message.status.map((status) => status.timestamp).filter(Boolean).sort((a, b) => a - b)[0]
    : null;
  return isoFromUnknownTimestamp(statusTimestamp);
}

function laterIso(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function respondMessageDirection(message) {
  const direction = normalize(message?.traffic || message?.direction);
  if (["incoming", "inbound"].includes(direction)) return "incoming";
  if (["outgoing", "outbound"].includes(direction)) return "outgoing";
  return null;
}

export function latestRespondRelevantMessage(messages) {
  let latest = null;
  for (const message of messages || []) {
    const direction = respondMessageDirection(message);
    const timestamp = respondMessageTimestamp(message);
    if (!direction || !timestamp) continue;
    if (!latest || timestamp > latest.timestamp) {
      latest = { message, direction, timestamp };
    }
  }
  return latest;
}

export function respondMessageSignals(messages, existingSnapshot = null) {
  let lastInbound = existingSnapshot?.respond_last_inbound_at || null;
  let lastOutbound = existingSnapshot?.respond_last_outbound_at || null;
  let lastHumanOutbound = existingSnapshot?.respond_last_human_outbound_at || null;
  let lastAiOutbound = existingSnapshot?.respond_last_ai_outbound_at || null;

  for (const message of messages || []) {
    const timestamp = respondMessageTimestamp(message);
    const direction = respondMessageDirection(message);
    if (!timestamp) continue;
    if (direction === "incoming") {
      lastInbound = laterIso(lastInbound, timestamp);
      continue;
    }
    if (direction !== "outgoing") continue;
    lastOutbound = laterIso(lastOutbound, timestamp);
    if (message.sender?.source === "user") lastHumanOutbound = laterIso(lastHumanOutbound, timestamp);
    if (["ai_agent", "workflow"].includes(message.sender?.source)) {
      lastAiOutbound = laterIso(lastAiOutbound, timestamp);
    }
  }

  const latestMessage = latestRespondRelevantMessage(messages);
  const unansweredSince = latestMessage?.direction === "incoming"
    ? latestMessage.timestamp
    : null;
  return {
    lastInbound,
    lastOutbound,
    lastHumanOutbound,
    lastAiOutbound,
    unansweredSince,
    latestMessageDirection: latestMessage?.direction || null,
    latestMessageAt: latestMessage?.timestamp || null,
  };
}

function currentRespondAssignee(contact) {
  const raw = contact?.assignee;
  if (!raw) return { assignee: null, state: "unassigned" };

  const status = normalize(raw.status || raw.state);
  const label = normalize(
    raw.name
    || raw.fullName
    || [raw.firstName, raw.lastName].filter(Boolean).join(" ")
  );
  const deleted = raw.deleted === true
    || raw.isDeleted === true
    || Boolean(raw.deletedAt || raw.deleted_at)
    || ["deleted", "removed", "inactive"].includes(status)
    || ["deleted user", "deleted_user"].includes(label);
  if (deleted) return { assignee: null, state: "deleted" };

  const unassigned = ["unassigned", "sin asignar"].includes(label)
    || (!raw.id && !raw.email);
  if (unassigned) return { assignee: null, state: "unassigned" };
  return { assignee: raw, state: "assigned" };
}

function isBlockedContact(contact) {
  return contact?.blocked === true
    || contact?.isBlocked === true
    || Boolean(contact?.blocked_at || contact?.blockedAt);
}

function classifySalesRelevance({ mappedProfile, area, blocked }) {
  if (blocked) return { salesRelevant: false, exclusionReason: "blocked" };
  const normalizedArea = normalize(area);
  const hasExplicitArea = normalizedArea.length > 0;
  if (hasExplicitArea && normalizedArea !== "ventas") {
    return { salesRelevant: false, exclusionReason: "area_outside_sales" };
  }
  const commercialProfile = mappedProfile?.active === true
    && ["asesor", "gerente_ventas"].includes(mappedProfile.role_id);
  if (commercialProfile) return { salesRelevant: true, exclusionReason: null };
  if (mappedProfile) return { salesRelevant: false, exclusionReason: "non_sales_assignee" };
  if (normalizedArea === "ventas") return { salesRelevant: true, exclusionReason: null };
  return { salesRelevant: false, exclusionReason: "unassigned_outside_sales" };
}

export function buildRespondSnapshot({
  contact,
  messages,
  profiles,
  existingSnapshot = null,
  messagePagesRead = 0,
  eventOccurredAt = null,
}) {
  const now = new Date().toISOString();
  const currentAssignee = currentRespondAssignee(contact);
  const assignee = currentAssignee.assignee;
  let mapped = resolveRespondProfile(assignee, profiles || []);
  if (currentAssignee.state !== "assigned") {
    mapped = {
      profile: null,
      status: "unmatched",
      method: currentAssignee.state === "deleted"
        ? "current_assignee_deleted"
        : "current_assignee_unassigned",
    };
  }

  const signals = respondMessageSignals(messages, existingSnapshot);
  const conversationStatus = contact.status || null;
  const conversationOpen = normalize(conversationStatus) === "open";
  const unansweredSince = conversationOpen
    ? signals.unansweredSince
    : null;
  const unansweredState = !conversationOpen
    ? "not_open"
    : signals.latestMessageDirection === "incoming"
      ? "waiting_inbound"
      : signals.latestMessageDirection === "outgoing"
        ? "answered_outbound"
        : "indeterminate_no_message_evidence";
  const area = customValue(contact, "atn_area");
  const blocked = isBlockedContact(contact);
  const relevance = classifySalesRelevance({ mappedProfile: mapped.profile, area, blocked });
  const active = true;
  const deactivatedAt = active
    ? null
    : existingSnapshot?.deactivated_at || now;
  const channelId = messages?.find((message) => message?.channelId)?.channelId
    || existingSnapshot?.respond_channel_id
    || null;
  const metadata = {
    mapping_method: mapped.method,
    sync_mode: "metadata_only",
    message_pages_read: messagePagesRead,
    unanswered_state: unansweredState,
    fields_present: Object.keys(contact || {}).filter(
      (key) => !["phone", "email", "profilePic", "comments", "messages"].includes(key)
    ),
  };
  if (relevance.salesRelevant) metadata.contact_name = contactDisplayName(contact);

  return {
    respond_contact_id: String(contact.id),
    respond_assignee_id: assignee?.id ? String(assignee.id) : null,
    respond_assignee_email: assignee?.email || null,
    mapped_profile_id: mapped.profile?.id || null,
    mapping_status: mapped.status,
    respond_channel_id: channelId ? String(channelId) : null,
    respond_channel_source: existingSnapshot?.respond_channel_source || null,
    respond_conversation_status: conversationStatus,
    respond_lifecycle: contact.lifecycle || null,
    respond_last_inbound_at: signals.lastInbound,
    respond_last_outbound_at: signals.lastOutbound,
    respond_last_human_outbound_at: signals.lastHumanOutbound,
    respond_last_ai_outbound_at: signals.lastAiOutbound,
    respond_unanswered_since: unansweredSince,
    respond_last_synced_at: now,
    atn_area: area,
    atn_servicio: customValue(contact, "atn_servicio"),
    atn_estado: customValue(contact, "atn_estado"),
    atn_destino: customValue(contact, "atn_destino"),
    atn_proxima_accion: customValue(contact, "atn_proxima_accion"),
    atn_fecha_proxima_accion: parseDateField(customValue(contact, "atn_fecha_proxima_accion")),
    atn_sla_vencido: [true, "true"].includes(customValue(contact, "atn_sla_vencido")),
    ven_presupuesto_compra: parseNumberField(customValue(contact, "ven_presupuesto_compra")),
    ven_renta_mensual_objetivo: parseNumberField(customValue(contact, "ven_renta_mensual_objetivo")),
    ven_plazo: customValue(contact, "ven_plazo"),
    inm_tipo: customValue(contact, "inm_tipo"),
    inm_zona: customValue(contact, "inm_zona"),
    sales_relevant: relevance.salesRelevant,
    respond_record_active: active,
    respond_blocked: blocked,
    exclusion_reason: relevance.exclusionReason,
    deactivated_at: deactivatedAt,
    last_seen_respond_at: now,
    last_event_at: laterIso(existingSnapshot?.last_event_at, eventOccurredAt),
    metadata,
    updated_at: now,
  };
}

export function buildMissingRespondSnapshot({ respondContactId, existingSnapshot, eventOccurredAt }) {
  const now = new Date().toISOString();
  return {
    ...(existingSnapshot || {}),
    id: undefined,
    created_at: undefined,
    respond_contact_id: String(respondContactId),
    sales_relevant: false,
    respond_record_active: false,
    respond_blocked: existingSnapshot?.respond_blocked || false,
    exclusion_reason: "not_found",
    deactivated_at: existingSnapshot?.deactivated_at || now,
    last_event_at: laterIso(existingSnapshot?.last_event_at, eventOccurredAt),
    respond_last_synced_at: now,
    metadata: {
      ...metadataWithoutContactPii(existingSnapshot?.metadata),
      sync_mode: "metadata_only",
      respond_lookup: "not_found",
    },
    updated_at: now,
  };
}

export function shouldPersistRespondSnapshot(snapshot) {
  return Boolean(snapshot?.respond_contact_id);
}

export function normalizeRespondContactResponse(body) {
  return body?.contact || body?.item || body?.data || body;
}

export async function fetchRespondContact(respondContactId) {
  const body = await respondRequest(`/contact/id:${encodeURIComponent(String(respondContactId))}`);
  const contact = normalizeRespondContactResponse(body);
  if (!contact?.id) throw new Error("Respond.io devolvio un contacto invalido.");
  return contact;
}

export async function readRespondMessages(respondContactId, maxPages = RESPOND_MAX_MESSAGE_PAGES_PER_CONTACT) {
  const messages = [];
  let nextPath = `/contact/id:${encodeURIComponent(String(respondContactId))}/message/list`;
  let pagesRead = 0;

  while (nextPath && pagesRead < maxPages) {
    const body = await respondRequest(nextPath, {
      params: nextPath.includes("?") ? undefined : { limit: RESPOND_MESSAGE_PAGE_LIMIT },
    });
    const pageMessages = respondItems(body);
    messages.push(...pageMessages);
    nextPath = respondPaginationNext(body);
    pagesRead += 1;

    // List Messages entrega primero la ventana de mensajes mas recientes. La
    // primera pagina con un inbound/outbound fechable aporta evidencia
    // inequívoca del ultimo mensaje relevante; las paginas siguientes son
    // historia anterior y no deben recorrerse por rutina.
    if (latestRespondRelevantMessage(pageMessages)) break;
  }

  return { messages, pagesRead, messageRequests: pagesRead };
}
