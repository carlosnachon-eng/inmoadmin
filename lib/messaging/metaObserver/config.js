import { messagingProviderError } from "../provider.js";

// A single endpoint, not a general channel/provider cutover. Database pinning
// independently binds these Meta IDs to the reviewed Administration scope.
export const ADMIN_RESPOND_CHANNEL_ID = "544519";
export const MAX_META_BODY_BYTES = 256 * 1024;
export const MAX_META_EVENTS = 100;
export const metaId = value => typeof value === "string" && /^[0-9]{5,32}$/.test(value);

export function metaObserverConfig(env = process.env) {
  if (env.META_ADMIN_OBSERVER_ENABLED !== "true") return null;
  const config = {
    wabaId: env.META_ADMIN_WABA_ID,
    phoneNumberId: env.META_ADMIN_PHONE_NUMBER_ID,
    appSecret: env.META_OBSERVER_APP_SECRET,
    verifyToken: env.META_OBSERVER_VERIFY_TOKEN,
  };
  if (!metaId(config.wabaId) || !metaId(config.phoneNumberId)
    || typeof config.appSecret !== "string" || config.appSecret.length < 32
    || config.appSecret.length > 256 || /\s/.test(config.appSecret)
    || typeof config.verifyToken !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(config.verifyToken)) {
    throw messagingProviderError("meta_observer_config_invalid");
  }
  return Object.freeze(config);
}
