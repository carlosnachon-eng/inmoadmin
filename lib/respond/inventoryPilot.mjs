import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { executeSalesTool } from '../agentsV2/openaiSalesAgent.js';

const DEV_ORIGIN = 'https://hjfwjnejbcpmknvfpdcq.supabase.co';
const TYPES = new Set(['Casa', 'Departamento', 'Terreno', 'Local', 'Oficina', 'Bodega']);
const KEYS = ['operation', 'city', 'propertyType'];
const fail = code => { throw new Error(code); };
const PUBLIC_COLUMNS = new Set('id,public_id,titulo,operacion,precio,moneda,tipo,recamaras,banos,estacionamientos,m2_construccion,m2_terreno,colonia,ciudad,estado,amenidades,mantenimiento_monto,mantenimiento_aplica,fecha_disponibilidad,mascotas_permitidas,amueblado,creditos_aceptados,status,plaza_id'.split(','));
const RESPONSE_SOURCE_COLUMNS = 'id,public_id,titulo,operacion,precio,moneda,tipo,recamaras,banos,ciudad,status';

function enabled(env) {
  // Explicitly require both app environment and exact database; never infer from traffic.
  return env.RESPOND_INVENTORY_PILOT_ENABLED === 'true'
    && ['development', 'preview'].includes(env.VERCEL_ENV)
    && env.SUPABASE_ENVIRONMENT === 'dev'
    && env.NEXT_PUBLIC_SUPABASE_URL === DEV_ORIGIN;
}
function authorized(req, env, now) {
  const hash = env.RESPOND_INVENTORY_PILOT_TOKEN_SHA256;
  const expiry = Date.parse(env.RESPOND_INVENTORY_PILOT_EXPIRES_AT);
  const header = req.headers?.authorization;
  if (!/^[a-f\d]{64}$/.test(hash || '') || !Number.isFinite(expiry)
    || expiry <= now || expiry > now + 86400000 || typeof header !== 'string') return false;
  const token = header.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!token) return false;
  return timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(hash, 'hex'));
}
function parameters(req) {
  const url = new URL(req.url, 'https://pilot.invalid');
  const values = {};
  for (const [key, value] of url.searchParams) {
    if (!KEYS.includes(key) || Object.hasOwn(values, key)) fail('invalid_request');
    values[key] = value;
  }
  // URL is authoritative; also reject non-scalar Next query objects and discrepancies.
  for (const [key, value] of Object.entries(req.query || {})) {
    if (!KEYS.includes(key) || typeof value !== 'string' || values[key] !== value) fail('invalid_request');
  }
  for (const [key, value] of Object.entries(values)) {
    if (!value || value !== value.trim()) fail('invalid_request');
    if (key === 'operation' && !['sale', 'rental'].includes(value)) fail('invalid_request');
    if (key === 'city' && (!/^[\p{L}]+(?: [\p{L}]+)*$/u.test(value) || value.length > 80)) fail('invalid_request');
    if (key === 'propertyType' && !TYPES.has(value)) fail('invalid_request');
  }
  return { values, missing: KEYS.filter(key => !Object.hasOwn(values, key)) };
}

// Capability around the existing query, not a second search implementation.
// No other table/method is available; attach cancellation to the actual PostgREST request.
function readCapability(db, signal, scope) {
  return { from(table) {
    if (table !== 'propiedades') fail('source_data_invalid');
    return { select(columns) {
      if (typeof columns !== 'string' || columns.split(',').some(c => !PUBLIC_COLUMNS.has(c))) fail('source_data_invalid');
      // Existing search remains authoritative; retrieve only fields needed by this public DTO.
      let query = db.from(table).select(RESPONSE_SOURCE_COLUMNS).abortSignal(signal);
      let published = false, bounded = false;
      const allowed = new Set(['eq', 'ilike', 'order', 'limit', 'or']);
      const proxy = new Proxy({}, { get(_target, method) {
        if (method === 'then') return (yes, no) => {
          if (!published || !bounded || signal.aborted) return Promise.reject(Error('source_data_invalid')).then(yes, no);
          return Promise.resolve(query).then(result => {
            if (result?.error) fail('source_unavailable');
            if (!Array.isArray(result?.data) || result.data.length > 5
              || result.data.some(row => row?.status !== 'published' || row.operacion !== scope.operation)) fail('source_data_invalid');
            return result;
          }).then(yes, no);
        };
        if (!allowed.has(method)) return () => fail('source_data_invalid');
        return (...args) => {
          if (method === 'eq' && args[0] === 'status') {
            if (args[1] !== 'published') fail('source_data_invalid');
            published = true;
          }
          if (method === 'limit') { if (args[0] !== 5) fail('source_data_invalid'); bounded = true; }
          query = query[method](...args);
          return proxy;
        };
      }});
      return proxy;
    }};
  }};
}
function label(value, max) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\p{C}<>@]|https?:\/\/|(?:\d[\s().,+-]*){7}/u.test(value)) fail('source_data_invalid');
  return value;
}
function number(value) {
  if (value == null) return null;
  if ((typeof value !== 'number' && typeof value !== 'string')
    || !/^\d+(?:\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))
    || Number(value) > Number.MAX_SAFE_INTEGER) fail('source_data_invalid');
  return Number(value);
}
export function publicInventoryTitle(value, price, currency) {
  if (typeof value !== 'string') fail('source_data_invalid');
  // Monetary exceptions belong only to the published title, never arbitrary labels.
  // Contact/identifier contexts remain ambiguous even if their digits equal the price.
  if (/\b(?:tel[eé]fono|tel|celular|cel|whatsapp|contacto|contactar|llama|llamar|phone|rfc|curp|folio|identificador|id)\b/iu.test(value)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(value)
    || /\b[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3,12}\b/u.test(value)) fail('source_data_invalid');
  let tokens = 0;
  const checked = value.replace(/(?:US\$|MXN\s*\$?|USD\s*\$?|\$)\s*\d[\d.,]*(?:\s*(?:MXN|USD))?/gu, token => {
    tokens++;
    const amount = token.match(/\d[\d.,]*/)?.[0];
    const explicit = token.match(/MXN|USD|US\$/g) || [];
    if (tokens > 1 || !['MXN','USD'].includes(currency)
      || explicit.some(c => (c === 'US$' ? 'USD' : c) !== currency)
      || (!explicit.length && currency !== 'MXN')
      || !/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(amount || '')
      || (amount.replace(/\D/g, '').length >= 7 && !amount.includes(','))
      || number(amount.replaceAll(',', '')) !== number(price)) fail('source_data_invalid');
    return 'PRECIO';
  });
  label(checked, 120);
  if (value.length > 120) fail('source_data_invalid');
  return value;
}
function project(row) {
  const code = row.publicId == null ? null : row.publicId;
  if (code !== null && (typeof code !== 'string' || !/^(?=.*[A-Za-z])[A-Za-z0-9_-]{1,80}$/.test(code)
    || /\d{7}/.test(code))) fail('source_data_invalid');
  const url = code ? `https://www.emporioinmobiliario.com.mx/propiedades/${encodeURIComponent(code)}` : null;
  if (row.publicUrl !== url || !['sale', 'rental'].includes(row.operation)) fail('source_data_invalid');
  if (row.currency != null && !/^[A-Z]{3}$/.test(row.currency)) fail('source_data_invalid');
  return { public_code: code, public_url: url, title: publicInventoryTitle(row.title, row.price, row.currency),
    operation: row.operation, city: label(row.city, 80), property_type: label(row.propertyType, 80),
    price: { amount: number(row.price), currency: row.currency ?? null },
    bedrooms: number(row.bedrooms), bathrooms: number(row.bathrooms),
    listing_status: 'published', availability: 'not_confirmed' };
}

// Shared bounded reader: policies are supplied only by trusted server factories.
export function createInventoryReadHandler({ getDb, env = () => process.env, now = Date.now,
  deadlineMs = 4000, observe = () => {}, policy }) {
  if (!policy || ['enabled', 'authorized', 'dataEnvironment'].some(key => typeof policy[key] !== 'function')) {
    throw new Error('inventory_server_policy_required');
  }
  // Per-process limiter only: this local pilot is NOT a distributed production service.
  let active = false, windowStart = null, count = 0;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const requestId = randomUUID(), cfg = env();
    const reply = (http, payload) => res.status(http).json({ request_id: requestId, ...payload });
    const error = (http, code) => reply(http, { status: 'error', code });
    if (!policy.enabled(cfg, now())) return error(404, 'not_found');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return error(405, 'method_not_allowed'); }
    if (!policy.authorized(req, cfg, now())) return error(401, 'unauthorized');
    let input;
    try { input = parameters(req); } catch { return error(400, 'invalid_request'); }
    let admission;
    const controlError = e => error(e?.message === 'control_disabled' ? 404 : e?.message === 'control_rate_limited' ? 429 : 503,
      e?.message === 'control_disabled' ? 'not_found' : e?.message === 'control_rate_limited' ? 'rate_limited' : 'control_unavailable');
    try { if (policy.admit) admission = await policy.admit(cfg); } catch(e) { return controlError(e); }
    const confirm = async () => {
      if (!policy.enabled(cfg, now())) fail('control_disabled');
      if (policy.confirm) await policy.confirm(cfg, admission);
    };
    const time = now();
    if (windowStart === null || time < windowStart || time - windowStart >= 60000) { windowStart = time; count = 0; }
    if (active || count >= 10) { res.setHeader('Retry-After', '60'); return error(429, 'rate_limited'); }
    count++;
    if (input.missing.length) {
      try { await confirm(); } catch(e) { return controlError(e); }
      if (!policy.authorized(req, cfg, now())) return error(401, 'unauthorized');
      return reply(200, { schema_version: 'inventory-pilot-v1',
      status: 'needs_clarification', data_environment: policy.dataEnvironment(cfg), missing_fields: input.missing,
      returned_count: 0, results: [] });
    }
    active = true;
    const started = performance.now(), controller = new AbortController();
    let timer, pending, timedOut = false;
    try {
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(Error('source_timeout')); }, deadlineMs);
      });
      pending = Promise.resolve().then(async () => {
        const db = await getDb();
        if (controller.signal.aborted) fail('source_timeout');
        const args = input.values;
        const socialContext = { sourcePropertyId: null, sourceProperty: null, messageText: '', inventory: null,
          search: { intent: 'general_search', filters: args } };
        return executeSalesTool(readCapability(db, controller.signal, args), 'search_sales_inventory', args, { socialContext });
      });
      const output = await Promise.race([pending, timeout]);
      if (!Array.isArray(output?.listings) || output.listings.length > 5
        || !['matched', 'empty'].includes(output.searchEvidence?.status)) fail('source_data_invalid');
      // Validate every bounded source row before truncating, never hide invalid rows as empty.
      const validated = output.listings.map(project);
      if (policy.validateResults) policy.validateResults(validated);
      const results = validated.slice(0, 3);
      try { await confirm(); } catch(e) { return controlError(e); }
      if (!policy.authorized(req, cfg, now())) return error(401, 'unauthorized');
      const payload = { schema_version: 'inventory-pilot-v1', status: results.length ? 'matched' : 'empty',
        queried_at: new Date(now()).toISOString(), data_environment: policy.dataEnvironment(cfg),
        scope: 'bounded_latest_published', exhaustive: false, filters: input.values,
        returned_count: results.length, results };
      if (Buffer.byteLength(JSON.stringify({ request_id: requestId, ...payload }), 'utf8') > 8192) fail('source_data_invalid');
      return reply(200, payload);
    } catch (e) {
      const code = timedOut ? 'source_timeout' : e?.message === 'source_data_invalid' ? 'source_data_invalid' : 'source_unavailable';
      return error(timedOut ? 504 : 503, code);
    } finally {
      clearTimeout(timer);
      try { observe({ request_id: requestId, duration_ms: performance.now() - started, timed_out: timedOut }); } catch { /* telemetry cannot change response */ }
      // If a driver ignores cancellation, retain the slot until it settles. Never pile up work.
      if (timedOut && pending) pending.then(() => { active = false; }, () => { active = false; });
      else active = false;
    }
  };
}

// Historical DEV route retains its exact environment/authentication contract.
export function createInventoryPilotHandler(options) {
  return createInventoryReadHandler({ ...options,
    policy: { enabled, authorized, dataEnvironment: () => 'dev' } });
}
