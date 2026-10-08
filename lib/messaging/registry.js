import { createRespondProvider } from "./providers/respond.js";
import { metaProvider } from "./providers/meta.js";
import { messagingProviderError } from "./provider.js";

// Explicit trusted selection, never from an inbound payload or process.env.
// No per-channel cutover or mutable provider registration in this phase.
export function createMessagingRegistry({ respondSendTextTransport } = {}) {
  const respond = createRespondProvider({ sendTextTransport: respondSendTextTransport });
  return Object.freeze({
    select(providerId = "respond") {
      if (providerId === "respond") return respond;
      if (providerId === "meta") throw messagingProviderError("messaging_meta_disconnected");
      throw messagingProviderError("messaging_provider_unknown");
    },
    describe() {
      return [{ id: respond.id, capabilities: respond.capabilities },
        { id: metaProvider.id, capabilities: metaProvider.capabilities }];
    },
  });
}

export const messagingRegistry = createMessagingRegistry();
