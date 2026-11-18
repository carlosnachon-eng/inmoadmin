import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { resolveConfirmedContactIdentity } from '../shadow/identityBridge.js';
import { CONDOMINIUM_RESPOND_SOURCE } from '../shadow/condominiumIdentity.js';
import { shadowContextTools } from '../shadow/context.js';

const DEV = 'https://hjfwjnejbcpmknvfpdcq.supabase.co';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const COMMON = ['client_identities', 'respond_identity_links'];
const TABLES = Object.freeze({
  rentals: [...COMMON, 'properties', 'contracts', 'payments'],
  condominium: [...COMMON, 'client_identity_roles', 'client_source_links', 'unidades_condominio', 'condominios'],
});
function validSubject(s) {
  if (!s || typeof s.hash !== 'string' || !/^[a-f0-9]{64}$/.test(s.hash)
    || typeof s.contact !== 'string' || !/^qa-f8-[a-z0-9-]{1,80}$/.test(s.contact)
    || !Object.hasOwn(TABLES, s.department) || !s.rows || Array.isArray(s.rows)) return false;
  const tables = TABLES[s.department];
  return Object.keys(s.rows).length === tables.length && tables.every(t =>
    Object.hasOwn(s.rows, t) && Array.isArray(s.rows[t]) && s.rows[t].length > 0
    && s.rows[t].length <= 100 && s.rows[t].every(id => typeof id === 'string' && UUID.test(id)));
}
const stop = code => { throw Error(code); };
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const money = x => {
  if (x === null || x === undefined) return null;
  if (!['number', 'string'].includes(typeof x) || !/^\d+(\.\d{1,2})?$/.test(String(x))
    || !Number.isSafeInteger(Math.round(Number(x) * 100))) stop('source_data_invalid');
  return Number(x);
};

function settings(env, now) {
  if (env.RESPOND_ADMIN_PILOT_ENABLED !== 'true' || !['development', 'preview'].includes(env.VERCEL_ENV)
    || env.SUPABASE_ENVIRONMENT !== 'dev' || env.NEXT_PUBLIC_SUPABASE_URL !== DEV) return null;
  const expiry = Date.parse(env.RESPOND_ADMIN_PILOT_EXPIRES_AT);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 86400000) return null;
  try {
    const cfg = JSON.parse(env.RESPOND_ADMIN_PILOT_SCOPE_JSON);
    if (!Array.isArray(cfg.subjects) || !cfg.subjects.length || cfg.subjects.length > 12
      || cfg.subjects.some(s => !validSubject(s))
      || new Set(cfg.subjects.map(s => s.hash)).size !== cfg.subjects.length
      || new Set(cfg.subjects.map(s => s.contact)).size !== cfg.subjects.length) return null;
    return cfg;
  } catch { return null; }
}

// The operator-issued credential selects ONE synthetic contact. No contact/person/contract
// parameter exists. This is a simulator capability, NOT production contact attestation.
function subject(req, cfg) {
  const header = req.headers?.authorization;
  const token = typeof header === 'string' ? header.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1] : null;
  if (!token) return null;
  const digest = createHash('sha256').update(token).digest();
  return cfg.subjects.find(s => timingSafeEqual(digest, Buffer.from(s.hash, 'hex'))) || null;
}

// All queries, including existing Identity Bridge queries, are read-only and restricted
// to exact synthetic IDs. The service key can never expose preexisting DEV records here.
function capability(db, actor, signal) {
  return { from(table) {
    if (!Object.hasOwn(actor.rows, table)) stop('source_data_invalid');
    return { select(columns) {
      if (typeof columns !== 'string' || columns.includes('*')) stop('source_data_invalid');
      let q = db.from(table).select(columns).in('id', actor.rows[table]).limit(101).abortSignal(signal);
      const proxy = new Proxy({}, { get(_t, method) {
        if (method === 'then') return (yes, no) => Promise.resolve(q).then(result => {
          if (signal.aborted) stop('source_timeout');
          if (result.error) stop('source_unavailable');
          if (!Array.isArray(result.data) || result.data.length > 100
            || result.data.some(r => !actor.rows[table].includes(r.id))) stop('source_data_invalid');
          return result;
        }).then(yes, no);
        if (!['eq', 'in', 'lte', 'gte', 'order', 'limit'].includes(method)) return () => stop('source_data_invalid');
        return (...args) => {
          if (method === 'limit' && (!Number.isInteger(args[0]) || args[0] < 1 || args[0] > 101)) stop('source_data_invalid');
          q = q[method](...args); return proxy;
        };
      }});
      return proxy;
    }};
  }};
}

export function createAdminIdentityPilotHandler({ getDb, env = () => process.env, now = Date.now, deadlineMs = 4000 }) {
  let busy = false, windowStart = 0, count = 0;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (http, data) => res.status(http).json({ request_id: randomUUID(), data_environment: 'dev', ...data });
    const cfg = settings(env(), now());
    if (!cfg) return reply(404, { status: 'error', code: 'not_found' });
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return reply(405, { status: 'error', code: 'method_not_allowed' }); }
    const actor = subject(req, cfg);
    if (!actor) return reply(401, { status: 'error', code: 'unauthorized' });
    if (typeof req.url !== 'string' || req.url.includes('?') || Object.keys(req.query || {}).length
      || req.body !== undefined || req.headers?.['transfer-encoding']
      || (req.headers?.['content-length'] !== undefined && req.headers['content-length'] !== '0')) return reply(400, { status: 'error', code: 'invalid_request' });
    if (now() - windowStart >= 60000 || now() < windowStart) { windowStart = now(); count = 0; }
    if (busy || count >= 20) { res.setHeader('Retry-After', '60'); return reply(429, { status: 'error', code: 'rate_limited' }); }
    count++; busy = true;
    const controller = new AbortController(); let timer, pending, timedOut = false;
    try {
      pending = Promise.resolve().then(async () => {
        const db = capability(await getDb(), actor, controller.signal);
        const links = await db.from('respond_identity_links').select('id,link_source,revoked_at')
          .eq('respond_contact_id', actor.contact).eq('link_status', 'confirmed').limit(2);
        const condo = actor.department === 'condominium';
        if (links.data.length !== 1 || links.data[0].revoked_at || !(condo
          ? links.data[0].link_source === CONDOMINIUM_RESPOND_SOURCE
          : ['human_confirmation', 'explicit_operational_link'].includes(links.data[0].link_source))) stop('identity_unavailable');
        const identity = await resolveConfirmedContactIdentity(db, actor.contact, { audit: false });
        if (!identity.resolved || !identity.clientContextKey || identity.linkId !== links.data[0].id
          || identity.linkSource !== links.data[0].link_source) stop('identity_unavailable');
        if (condo) {
          if (identity.identityDomain !== 'condominium' || identity.ambiguousUnitContext
            || identity.units?.length !== 1 || identity.units[0].active !== true
            || identity.selectedUnitId !== identity.units[0].id) stop('human_review_required');
          // The existing resolver verifies the relationship only. Fee sources are not interchangeable.
          return { schema_version: 'admin-pilot-v1', status: 'matched', identity: 'confirmed',
            department: 'condominium', role: 'owner', relationship: 'active',
            fees: 'human_review_required', scope: 'single_synthetic_contact_capability' };
        }
        if (identity.identityDomain === 'condominium') stop('identity_unavailable');
        const canonical = await db.from('client_identities').select('id,status,revoked_at').eq('id', identity.clientContextKey);
        if (canonical.data.length !== 1 || canonical.data[0].status !== 'active' || canonical.data[0].revoked_at) stop('identity_unavailable');
        if (identity.ambiguousPropertyContext || identity.properties.length !== 1 || identity.roles.length !== 1) stop('human_review_required');
        const propertyId = identity.properties[0].id;
        const prop = await db.from('properties').select('id,owner_client_id,administration_ended_at').eq('id', propertyId);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
        if (!day(today) || prop.data.length !== 1 || (prop.data[0].administration_ended_at
          && (!day(prop.data[0].administration_ended_at) || prop.data[0].administration_ended_at <= today))) stop('human_review_required');
        let contractId;
        if (identity.roles[0] === 'owner') {
          if (prop.data[0].owner_client_id !== identity.clientContextKey) stop('identity_unavailable');
          const contracts = await shadowContextTools.find_active_contracts(db, { propertyId });
          // Refuse truncated or ambiguous results, including multiple apparently active contracts.
          if (contracts.length !== 1) stop('human_review_required');
          contractId = contracts[0].internalId;
        } else if (identity.roles[0] === 'tenant') {
          const contracts = identity.contracts.filter(c => c.propertyId === propertyId && c.active
            && day(c.startDate) && day(c.endDate) && c.startDate <= today && c.endDate >= today);
          if (contracts.length !== 1) stop('human_review_required');
          contractId = contracts[0].id;
        } else stop('identity_unavailable');
        const contracts = await shadowContextTools.find_active_contracts(db, { contractId }, { propertyId, effectiveOn: today, includeRent: true });
        if (contracts.length !== 1) stop('human_review_required');
        const payments = await shadowContextTools.get_payment_summary(db, { contractId }, { period: today.slice(0, 7) });
        const payload = { schema_version: 'admin-pilot-v1', status: 'matched', identity: 'confirmed',
          department: 'rentals', role: identity.roles[0], contract: { status: 'active', start_date: contracts[0].startDate,
            end_date: contracts[0].endDate, monthly_rent: { amount: money(contracts[0].monthlyRent), currency: null } },
          payment_period: today.slice(0, 7), payments_exhaustive: payments.length <= 10,
          recorded_payments: payments.map(p => {
            if (!['pendiente', 'en_revision', 'pagado', 'atrasado'].includes(p.status)) stop('source_data_invalid');
            return { due_date: p.period, amount: money(p.amount), currency: null, recorded_status: p.status,
              bank_receipt_confirmed: false, evidence: 'database_record_only' };
          }).slice(0, 10), currency_note: 'Currency is not stored in this administrative schema. Ask a human; do not infer it.',
          bank_note: 'A recorded payment status is not proof of bank receipt.', scope: 'single_synthetic_contact_capability' };
        if (Buffer.byteLength(JSON.stringify(payload)) > 8192) stop('source_data_invalid');
        return payload;
      });
      const timeout = new Promise((_r, reject) => { timer = setTimeout(() => {
        timedOut = true; controller.abort(); reject(Error('source_timeout'));
      }, deadlineMs); });
      const result = await Promise.race([pending, timeout]);
      const fresh = settings(env(), now());
      if (!fresh) return reply(404, { status: 'error', code: 'not_found' });
      if (JSON.stringify(subject(req, fresh)) !== JSON.stringify(actor)) {
        return reply(401, { status: 'error', code: 'unauthorized' });
      }
      return reply(200, result);
    } catch (e) {
      if (e.message === 'identity_unavailable') return reply(403, { status: 'human_review_required', code: 'identity_unavailable' });
      if (e.message === 'human_review_required') return reply(409, { status: 'human_review_required', code: 'scope_ambiguous_or_inactive' });
      return reply(timedOut ? 504 : 503, { status: 'error', code: timedOut ? 'source_timeout'
        : e.message === 'source_data_invalid' ? 'source_data_invalid' : 'source_unavailable' });
    } finally {
      clearTimeout(timer);
      if (timedOut && pending) pending.then(() => { busy = false; }, () => { busy = false; });
      else busy = false;
    }
  };
}
