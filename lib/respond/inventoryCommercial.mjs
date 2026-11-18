import { createHash, timingSafeEqual } from 'node:crypto';
import { createInventoryReadHandler } from './inventoryPilot.mjs';

const ORIGINS = Object.freeze({
  dev: 'https://hjfwjnejbcpmknvfpdcq.supabase.co',
  production: 'https://bnzrnizrmonjxlktbhlp.supabase.co',
});
const DAY = 86400000;
const OVERLAP = 15 * 60000;

// Only public/publishable credentials. Never fall back to the app's service_role.
export function inventoryPublicKey(key, source) {
  if (typeof key !== 'string' || key.length > 2048) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return true;
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.role === 'anon' && claims.ref === new URL(ORIGINS[source]).hostname.split('.')[0];
  } catch { return false; }
}

export function commercialEnabled(cfg, now = Date.now()) {
  const source = cfg.RESPOND_INVENTORY_SOURCE;
  if (cfg.RESPOND_INVENTORY_ENABLED !== 'true' || !Object.hasOwn(ORIGINS, source)
    || cfg.RESPOND_INVENTORY_SUPABASE_URL !== ORIGINS[source]
    || !inventoryPublicKey(cfg.RESPOND_INVENTORY_SUPABASE_PUBLIC_KEY, source)) return false;
  const start = Date.parse(cfg.RESPOND_INVENTORY_WINDOW_START);
  const end = Date.parse(cfg.RESPOND_INVENTORY_WINDOW_END);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
    || end - start > DAY || now < start || now >= end) return false;
  if (source === 'dev') return ['development', 'preview'].includes(cfg.VERCEL_ENV);
  // Environment attestation alone is not an installed firewall. Deployment runbook
  // requires independent verification of WAF limit/deny rules before setting this.
  return cfg.VERCEL_ENV === 'production'
    && cfg.RESPOND_INVENTORY_PRODUCTION_READ_APPROVED === 'true'
    && cfg.RESPOND_INVENTORY_EDGE_GUARD_VERIFIED === 'true';
}

function keyWindow(cfg, prefix, now, maxLifetime) {
  const hash = cfg[`${prefix}_SHA256`];
  const from = Date.parse(cfg[`${prefix}_FROM`]);
  const until = Date.parse(cfg[`${prefix}_UNTIL`]);
  if (!/^[a-f\d]{64}$/.test(hash || '') || !Number.isFinite(from) || !Number.isFinite(until)
    || until <= from || until - from > maxLifetime || now < from || now >= until) return null;
  return Buffer.from(hash, 'hex');
}
export function commercialAuthorized(req, cfg, now) {
  const header = req.headers?.authorization;
  const token = typeof header === 'string' && header.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!token) return false;
  const current = keyWindow(cfg, 'RESPOND_INVENTORY_TOKEN_CURRENT', now, DAY);
  // A valid current credential is mandatory, even while rotating the old one.
  if (!current) return false;
  const previous = keyWindow(cfg, 'RESPOND_INVENTORY_TOKEN_PREVIOUS', now, OVERLAP);
  const presented = createHash('sha256').update(token).digest();
  const currentMatch = timingSafeEqual(current, presented);
  const previousMatch = previous ? timingSafeEqual(previous, presented) : false;
  return currentMatch || previousMatch;
}

export function createCommercialInventoryHandler(options) {
  const control = options.sharedControl;
  return createInventoryReadHandler({ ...options,
    policy: { enabled: commercialEnabled, authorized: commercialAuthorized,
      admit: () => { if (!control) throw Error('control_unavailable'); return control.consume(); },
      confirm: (_cfg, generation) => { if (!control) throw Error('control_unavailable'); return control.check(generation); },
      dataEnvironment: cfg => cfg.RESPOND_INVENTORY_SOURCE,
      validateResults: rows => {
        if (rows.some(row => !row.public_code || !row.public_url || !row.title
          || row.price.amount === null || row.price.amount <= 0 || !row.price.currency)) {
          throw new Error('source_data_invalid');
        }
      } } });
}

export function createPublicInventoryDb(createClient, cfg) {
  if (!commercialEnabled(cfg)) throw new Error('inventory_configuration_disabled');
  return createClient(cfg.RESPOND_INVENTORY_SUPABASE_URL,
    cfg.RESPOND_INVENTORY_SUPABASE_PUBLIC_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
}
