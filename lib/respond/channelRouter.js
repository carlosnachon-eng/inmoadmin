const INBOUND_MESSAGE_EVENTS = new Set(["message.received", "new_incoming_message"]);
const MAX_CHANNEL_ID_LENGTH = 80;
const MAX_IDENTIFIER_LENGTH = 200;
const RESPOND_WORKFLOW_HOST = "hooks.respond.io";

const clean = (value, max = MAX_IDENTIFIER_LENGTH) => String(value ?? "").trim().slice(0, max);
const enabled = (value) => clean(value, 10).toLowerCase() === "true";

function configurationError(reason) {
  return { enabled: false, valid: false, reason };
}

function parseCommercialChannelIds(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    const normalized = parsed.map((item) => clean(item, MAX_CHANNEL_ID_LENGTH));
    if (normalized.some((item) => !item)) return null;
    return [...new Set(normalized)];
  } catch {
    return null;
  }
}

function workflowUrl(value) {
  try {
    const url = new URL(clean(value, 2000));
    if (
      url.protocol !== "https:"
      || url.hostname !== RESPOND_WORKFLOW_HOST
      || url.username
      || url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveRespondChannelRouterConfig({
  routerEnabled = process.env.RESPOND_CHANNEL_ROUTER_ENABLED,
  adminChannelId = process.env.RESPOND_CHANNEL_ROUTER_ADMIN_CHANNEL_ID,
  commercialChannelIds = process.env.RESPOND_CHANNEL_ROUTER_COMMERCIAL_CHANNEL_IDS,
  adminWorkflowUrl = process.env.RESPOND_CHANNEL_ROUTER_ADMIN_WORKFLOW_URL,
  commercialWorkflowUrl = process.env.RESPOND_CHANNEL_ROUTER_COMMERCIAL_WORKFLOW_URL,
} = {}) {
  if (!enabled(routerEnabled)) return { enabled: false, valid: true, reason: "disabled" };

  const admin = clean(adminChannelId, MAX_CHANNEL_ID_LENGTH);
  const commercial = parseCommercialChannelIds(commercialChannelIds);
  if (!admin) return configurationError("missing_admin_channel_id");
  if (!commercial) return configurationError("invalid_commercial_channel_ids");
  if (commercial.includes(admin)) return configurationError("channel_allowlists_overlap");

  const adminUrl = workflowUrl(adminWorkflowUrl);
  const commercialUrl = workflowUrl(commercialWorkflowUrl);
  if (!adminUrl || !commercialUrl || adminUrl === commercialUrl) {
    return configurationError("invalid_workflow_urls");
  }

  return {
    enabled: true,
    valid: true,
    adminChannelId: admin,
    commercialChannelIds: new Set(commercial),
    adminWorkflowUrl: adminUrl,
    commercialWorkflowUrl: commercialUrl,
  };
}

export function decideRespondMessageRoute(event, config = resolveRespondChannelRouterConfig()) {
  if (!config.enabled) return { route: false, reason: config.reason || "disabled" };
  if (!config.valid) return { route: false, reason: config.reason || "invalid_configuration" };

  const eventType = clean(event?.eventType, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!INBOUND_MESSAGE_EVENTS.has(eventType)) return { route: false, reason: "not_inbound_message" };

  const eventId = clean(event?.eventId);
  const messageId = clean(event?.messageId);
  const contactId = clean(event?.respondContactId);
  const channelId = clean(event?.channelId, MAX_CHANNEL_ID_LENGTH);
  if (!eventId && !messageId) return { route: false, reason: "missing_event_identity" };
  if (!contactId) return { route: false, reason: "missing_contact_id" };
  if (!channelId) return { route: false, reason: "missing_channel_id" };

  if (channelId === config.adminChannelId) {
    return {
      route: true,
      decision: "admin_human",
      target: "administracion",
      workflowUrl: config.adminWorkflowUrl,
      eventId,
      messageId,
      contactId,
      channelId,
    };
  }

  if (config.commercialChannelIds.has(channelId)) {
    return {
      route: true,
      decision: "commercial_ivonne",
      target: "ivonne_recepcion_v2",
      workflowUrl: config.commercialWorkflowUrl,
      eventId,
      messageId,
      contactId,
      channelId,
    };
  }

  return {
    route: false,
    reason: "unknown_channel_fail_safe",
    decision: "human_unassigned",
    target: "none",
    eventId,
    messageId,
    contactId,
    channelId,
  };
}

export function respondRoutingAudit(decision, result, now = new Date().toISOString()) {
  return {
    message_id: decision?.messageId || null,
    channel_id: decision?.channelId || null,
    routing_decision: decision?.decision || decision?.reason || "not_routed",
    target: decision?.target || "none",
    routed_at: now,
    result,
  };
}

export async function invokeRespondRoutingWorkflow(decision, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
} = {}) {
  if (!decision?.route) return { status: "skipped", reason: decision?.reason || "not_routed" };
  if (typeof fetchImpl !== "function") throw new Error("respond_router_fetch_unavailable");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(decision.workflowUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactId: decision.contactId,
        eventId: decision.eventId || null,
        messageId: decision.messageId || null,
        channelId: decision.channelId,
        routingDecision: decision.decision,
      }),
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`respond_router_workflow_http_${response?.status || "unknown"}`);
    return { status: "routed", decision: decision.decision, target: decision.target };
  } finally {
    clearTimeout(timeout);
  }
}

export async function routeRespondMessageIsolated(event, options = {}) {
  const config = options.config || resolveRespondChannelRouterConfig(options);
  const decision = decideRespondMessageRoute(event, config);
  if (!decision.route) {
    return { ...decision, audit: respondRoutingAudit(decision, decision.reason || "skipped", options.now) };
  }
  try {
    const result = await invokeRespondRoutingWorkflow(decision, options);
    return { ...decision, ...result, audit: respondRoutingAudit(decision, result.status, options.now) };
  } catch (error) {
    console.error("[respond-channel-router-isolated]", error?.message || "routing_failed");
    return {
      ...decision,
      status: "isolated_error",
      error: clean(error?.message || "routing_failed", 160),
      audit: respondRoutingAudit(decision, "isolated_error", options.now),
    };
  }
}
