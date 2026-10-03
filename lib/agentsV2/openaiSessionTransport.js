// Same Agents API protocol as Sales/Owner/Legal V2, with an exact pre-verified
// body entry point for Shadow. No provider-side tools, retries or raw error logs.
export const OPENAI_AGENT_SESSIONS_URL = "https://api.openai.com/v1/agents/sessions";
export const openAiSessionId = value => typeof value === "string" && /^sess_[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
export function openAiAgentHeaders(env) {
  return { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "OpenAI-Beta": "agents=v1", "Content-Type": "application/json" };
}
// Bound even an implementation/transport that does not settle on abort. Late
// results are ignored; an uncertain POST is never repeated.
export async function abortableOpenAiRequest(operation, signal) {
  const timeout = () => Object.assign(new Error("model_timeout"), { timeoutStage: "model_timeout" });
  if (signal?.aborted) throw timeout();
  let listener;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      listener = () => reject(timeout()); signal?.addEventListener("abort", listener, { once: true });
    })]);
  } finally { signal?.removeEventListener("abort", listener); }
}
export async function requestOpenAiSession(path, { env, fetchImpl = fetch, signal, body, method = "GET" }) {
  if (path !== "" && !/^\/sess_[A-Za-z0-9_-]{1,160}(?:\/(?:turns|items|events))?(?:\?order=asc&limit=100)?$/.test(path)) throw new Error("provider_invalid_session_reference");
  const response = await abortableOpenAiRequest(() => fetchImpl(`${OPENAI_AGENT_SESSIONS_URL}${path}`, {
    method, headers: openAiAgentHeaders(env), ...(body === undefined ? {} : { body }), signal, redirect: "error",
  }), signal);
  if (!response.ok) {
    // Do not read/retain provider free text, headers or response bodies on error.
    const error = new Error("provider_http_error");
    error.code = "provider_http_error"; error.outputStage = "provider_http";
    error.httpStatus = Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? response.status : null;
    throw error;
  }
  if (method === "POST" && path.endsWith("/events") && response.status === 204) return {};
  try { return await abortableOpenAiRequest(() => response.json(), signal); }
  catch (error) { if (error.timeoutStage) throw error; throw new Error("provider_response_invalid_json"); }
}
