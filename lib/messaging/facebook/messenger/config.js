// Independent commercial Messenger adapter. Never fall back to Instagram/legacy env.
export const PROVIDER = 'facebook_messenger';
export const CHANNEL = 'facebook_dm';
export const isRef = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const isId = x => typeof x === 'string' && /^\d{1,32}$/.test(x);
export const isUuid = x => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
export const isMid = x => typeof x === 'string' && /^[A-Za-z0-9_.:=$-]{1,1024}$/.test(x);
export function messengerEnvironmentAllowed(env){
 const environment=env.FACEBOOK_MESSENGER_ENV || env.APP_ENV;
 if(env.VERCEL_ENV==='production')return environment==='production'
  &&env.FACEBOOK_MESSENGER_ROLLOUT==='closed_manual'
  &&env.NEXT_PUBLIC_SUPABASE_URL==='https://bnzrnizrmonjxlktbhlp.supabase.co';
 return ['test','development','preview'].includes(environment)
  &&env.NEXT_PUBLIC_SUPABASE_URL==='https://hjfwjnejbcpmknvfpdcq.supabase.co';
}
export function messengerConfig(env) {
  if (env.FACEBOOK_MESSENGER_ENABLED !== 'true') return null;
  // Production requires its own database AND explicit closed-manual rollout.
  // Preparing this code does not provision or enable either production gate.
  if (!messengerEnvironmentAllowed(env)) throw Error('environment_denied');
  const c = {
    provider: PROVIDER, connection: env.FACEBOOK_MESSENGER_CONNECTION_ID,
    app: env.FACEBOOK_MESSENGER_APP_ID, page: env.FACEBOOK_MESSENGER_PAGE_ID,
    secret: env.FACEBOOK_MESSENGER_APP_SECRET, verify: env.FACEBOOK_MESSENGER_VERIFY_TOKEN,
    indexKey: env.FACEBOOK_MESSENGER_INDEX_KEY, dataKey: env.FACEBOOK_MESSENGER_DATA_KEY,
    tokenKey: env.FACEBOOK_MESSENGER_TOKEN_KEY, version: 'v26.0',
    senderEnabled: env.FACEBOOK_MESSENGER_MANUAL_SEND_ENABLED === 'true',
  };
  if (!isUuid(c.connection) || !isId(c.app) || !isId(c.page)
    || ![c.secret,c.verify].every(x => typeof x === 'string' && x.length >= 32 && x.length <= 256)
    || ![c.indexKey,c.dataKey,c.tokenKey].every(x => /^[a-f0-9]{64}$/.test(x || ''))
    || new Set([c.secret,c.verify,c.indexKey,c.dataKey,c.tokenKey]).size !== 5) throw Error('configuration_incomplete');
  return Object.freeze(c);
}
