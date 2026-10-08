/**
 * Transport-only contract. Providers never authorize a model, send, retry,
 * handoff, assignment, pause or resumption. Existing callers retain those gates.
 * Normalization is pure, NOT authentication: verifyWebhook must succeed first
 * at the HTTP boundary. IDs are opaque and scoped to their provider.
 *
 * @typedef {Object} MessagingProvider
 * @property {string} id
 * @property {Readonly<Object>} capabilities
 * @property {Function} verifyWebhook (body, signature, signingKeys) => boolean
 * @property {Function} normalizeWebhook (body) => MessagingEvent
 * @property {Function} normalizeInbound (body) => MessagingEvent[]
 * @property {Function} normalizeStatus (body) => MessagingEvent[]
 * @property {Function} normalizeHumanOutbound (body) => MessagingEvent[]
 * @property {Function} sendText (intent) => Promise<unknown>
 * @property {Function} sendMedia (intent) => Promise<unknown>
 *
 * sendText delegates ONCE to an explicitly supplied, already-guarded sender.
 * Its result/errors are opaque in this phase: do not convert HTTP acceptance
 * into delivery, translate uncertain results, add retries or change journals.
 */
export function messagingProviderError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function defineMessagingProvider(provider) {
  for (const name of ["verifyWebhook", "normalizeWebhook", "normalizeInbound",
    "normalizeStatus", "normalizeHumanOutbound", "sendText", "sendMedia"]) {
    if (typeof provider[name] !== "function") {
      throw messagingProviderError("messaging_provider_contract_invalid");
    }
  }
  if (!["respond", "meta"].includes(provider.id)) {
    throw messagingProviderError("messaging_provider_contract_invalid");
  }
  return Object.freeze({ ...provider, capabilities: Object.freeze({ ...provider.capabilities }) });
}
