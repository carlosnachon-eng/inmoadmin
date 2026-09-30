import { READ_ONLY_SHADOW_TOOLS, SHADOW_TOOL_ARGUMENT_SCHEMAS, executeShadowReadOnlyTool } from "../shadow/context.js";

export const ADMIN_AGENT_V2_TOOL_NAMES = Object.freeze([
  "resolve_contact_identity",
  "find_properties",
  "find_active_contracts",
  "get_payment_summary",
  "get_service_period_status",
  "get_maintenance_ticket_summary",
]);

const DESCRIPTIONS = Object.freeze({
  resolve_contact_identity: "Resolve a Respond contact only through an already-confirmed InmoAdmin identity link. Never infer identity.",
  find_properties: "Read an InmoAdmin property by exact id or explicit property reference.",
  find_active_contracts: "Read active contracts for an exact contract or property id.",
  get_payment_summary: "Read recent rent payment records for an exact payment or contract id. Never confirm bank receipt.",
  get_service_period_status: "Read utility/service payment status for an exact service or property/service pair.",
  get_maintenance_ticket_summary: "Read maintenance ticket status for an exact ticket or property id. Never create, update, or close tickets.",
});

export function assertAdminAgentV2Environment(env = process.env) {
  if (env.ADMIN_AGENT_V2_ENABLED !== "true") throw new Error("admin_agent_v2_disabled");
  if (env.VERCEL_ENV === "production" || env.SUPABASE_ENVIRONMENT === "production") {
    throw new Error("admin_agent_v2_production_forbidden");
  }
  if (env.SHADOW_OUTBOUND_ENABLED === "true" || env.SHADOW_ADMIN_OUTBOUND_ENABLED === "true") {
    throw new Error("admin_agent_v2_outbound_forbidden");
  }
  if (!env.OPENAI_API_KEY) throw new Error("openai_api_key_required");
  if (!env.OPENAI_ADMIN_AGENT_MODEL) throw new Error("openai_admin_agent_model_required");
  return true;
}

function apiHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "agents=v1",
  };
}

export function buildAdminAgentV2Tools() {
  return ADMIN_AGENT_V2_TOOL_NAMES.map((name) => {
    if (!READ_ONLY_SHADOW_TOOLS.includes(name)) throw new Error("admin_agent_v2_tool_not_read_only");
    return {
      type: "function",
      name,
      description: DESCRIPTIONS[name],
      parameters: SHADOW_TOOL_ARGUMENT_SCHEMAS[name],
    };
  });
}

export function buildAdminAgentV2Config(env = process.env) {
  return {
    model: env.OPENAI_ADMIN_AGENT_MODEL,
    instructions: [
      "Eres la Administradora IA de Emporio Inmobiliario en modo de evaluación read-only.",
      "Usa únicamente las funciones disponibles para obtener hechos operativos.",
      "Nunca infieras identidad, inmueble, contrato, pago o autorización.",
      "Si identidad o inmueble no son determinísticos, pide aclaración o exige revisión humana.",
      "Nunca confirmes recepción bancaria basándote en un comprobante o mensaje.",
      "Nunca prometas acciones jurídicas, financieras, de mantenimiento o de proveedor.",
      "No ejecutes ni sugieras mutaciones. No envíes mensajes a clientes.",
      "Devuelve una respuesta breve y segura basada solamente en datos verificados.",
    ].join("\n"),
    tools: buildAdminAgentV2Tools(),
  };
}

export async function createAdminAgentV2Session({ input, env = process.env, fetchImpl = fetch }) {
  assertAdminAgentV2Environment(env);
  const text = String(input || "").trim();
  if (!text || text.length > 4000) throw new Error("admin_agent_v2_input_invalid");
  const response = await fetchImpl("https://api.openai.com/v1/agents/sessions", {
    method: "POST",
    headers: apiHeaders(env),
    body: JSON.stringify({
      agent: buildAdminAgentV2Config(env),
      environment: { type: "none" },
      input: text,
      stream: false,
      metadata: { system: "inmoadmin", mode: "admin_agent_v2_shadow" },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`admin_agent_v2_create_failed_${response.status}`);
  if (!body?.id) throw new Error("admin_agent_v2_session_missing_id");
  return body;
}


export async function retrieveAdminAgentV2Session({ sessionId, env = process.env, fetchImpl = fetch }) {
  assertAdminAgentV2Environment(env);
  if (!sessionId) throw new Error("admin_agent_v2_session_invalid");
  const delays = [0, 300, 900, 1800];
  let lastStatus = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    const response = await fetchImpl(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: apiHeaders(env),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    lastStatus = response.status;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) throw new Error(`admin_agent_v2_retrieve_failed_${response.status}`);
  }
  throw new Error(`admin_agent_v2_retrieve_failed_${lastStatus || "unknown"}`);
}

export function pendingFunctionCalls(session) {
  return (session?.required_actions || []).filter((action) =>
    action?.type === "function_call" && ADMIN_AGENT_V2_TOOL_NAMES.includes(action?.name)
  );
}

export async function executeAdminAgentV2RequiredActions({ db, session, env = process.env, fetchImpl = fetch }) {
  assertAdminAgentV2Environment(env);
  if (!session?.id) throw new Error("admin_agent_v2_session_invalid");
  const calls = pendingFunctionCalls(session);
  if (!calls.length) return { handled: 0, session };

  const events = [];
  for (const call of calls) {
    const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
    try {
      const output = await executeShadowReadOnlyTool(db, call.name, args);
      events.push({
        type: "agent.session.input.tool_result",
        turn_id: call.turn_id,
        call_id: call.call_id,
        success: true,
        output: JSON.stringify(output),
      });
    } catch (error) {
      events.push({
        type: "agent.session.input.tool_result",
        turn_id: call.turn_id,
        call_id: call.call_id,
        success: false,
        error: String(error?.message || "tool_failed").slice(0, 120),
      });
    }
  }

  const response = await fetchImpl(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(session.id)}/events`, {
    method: "POST",
    headers: apiHeaders(env),
    body: JSON.stringify({ events }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`admin_agent_v2_tool_result_failed_${response.status}`);
  return { handled: events.length, result: body };
}
