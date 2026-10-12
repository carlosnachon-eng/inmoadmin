import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const IG_ACCOUNT = '17841440384433670';
export const IG_DEV_REF = 'hjfwjnejbcpmknvfpdcq';
export const MAX_IG_BYTES = 262144;
const hash = x => createHash('sha256').update(x).digest('hex');
const stable = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const nativeId = x => typeof x === 'string' && /^[A-Za-z0-9_.:=-]{1,512}$/.test(x);
const fail = (http = 400) => { throw Object.assign(new Error('invalid_observation'), { http }); };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.length <= 512 && timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));

// DEV-only by construction. Independent secrets; never reuse the WhatsApp receiver.
export function instagramObserverConfig(env) {
  if (env.INSTAGRAM_OBSERVER_ENABLED !== 'true') return null;
  if (env.VERCEL_ENV === 'production' || !['test', 'development', 'preview'].includes(env.APP_ENV)
    || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${IG_DEV_REF}.supabase.co`
    || env.INSTAGRAM_OBSERVER_ACCOUNT_ID !== IG_ACCOUNT) fail(503);
  for (const key of ['INSTAGRAM_OBSERVER_APP_SECRET', 'INSTAGRAM_OBSERVER_VERIFY_TOKEN', 'INSTAGRAM_OBSERVER_HMAC_KEY'])
    if (typeof env[key] !== 'string' || env[key].length < 32 || env[key].length > 256) fail(503);
  if (new Set([env.INSTAGRAM_OBSERVER_APP_SECRET, env.INSTAGRAM_OBSERVER_VERIFY_TOKEN, env.INSTAGRAM_OBSERVER_HMAC_KEY]).size !== 3) fail(503);
  return { account: IG_ACCOUNT, secret: env.INSTAGRAM_OBSERVER_APP_SECRET,
    verify: env.INSTAGRAM_OBSERVER_VERIFY_TOKEN, hmac: env.INSTAGRAM_OBSERVER_HMAC_KEY };
}

export function verifyInstagramSignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), Buffer.from(signature.slice(7), 'hex'));
}

// Metadata only: no text, usernames, attachments, URLs, recipients or raw payload.
// An observation fingerprint dedupes exact deliveries, NOT business effects or
// cross-provider identity. Changed observations of one native ID remain separate.
export function normalizeInstagramObservations(body, config) {
  if (body?.object !== 'instagram' || !Array.isArray(body.entry) || !body.entry.length || body.entry.length > 100) fail();
  const rows = [];
  let ignored = 0, count = 0;
  const ref = value => nativeId(value) ? createHmac('sha256', config.hmac).update(stable([config.account, value])).digest('hex') : null;
  function add(kind, event, timestamp, fields = {}) {
    const numeric = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;
    const time = numeric ? new Date(timestamp) : null;
    if (time && !Number.isFinite(time.getTime())) fail();
    rows.push({ observation_key: hash(stable([config.account, kind, event])), kind,
      occurred_at: time ? time.toISOString() : null,
      native_id: null, subject_ref: null, media_id: null, parent_id: null,
      provenance: 'unknown', relation_state: 'unresolved', ...fields });
  }
  for (const entry of body.entry) {
    if (entry?.id !== config.account) fail(403);
    for (const field of ['messaging', 'changes']) if (entry[field] !== undefined && !Array.isArray(entry[field])) fail();
    count += (entry.messaging?.length || 0) + (entry.changes?.length || 0);
    if (count > 100) fail();
    for (const event of entry.messaging || []) {
      if (!event || typeof event !== 'object') fail();
      const message = event.message;
      if (!message) { ignored++; continue; }
      if (!nativeId(message.mid) || !nativeId(event.sender?.id) || !nativeId(event.recipient?.id)) fail();
      const echo = message.is_echo === true;
      if (echo ? event.sender.id !== config.account : event.recipient.id !== config.account) fail(403);
      if (!echo && event.sender.id === config.account) fail(403);
      add(echo ? 'dm_echo' : 'dm', event, event.timestamp, {
        native_id: message.mid, subject_ref: ref(echo ? event.recipient.id : event.sender.id),
        provenance: echo ? 'business_outbound_unattributed' : 'customer_inbound',
        relation_state: 'exact_subject',
      });
    }
    for (const change of entry.changes || []) {
      if (!['comments', 'mentions'].includes(change?.field)) { ignored++; continue; }
      const v = change.value;
      if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
      const id = change.field === 'comments' ? v.id : (v.comment_id || v.media_id);
      if (!nativeId(id)) fail();
      const media = v.media?.id || v.media_id;
      const parent = v.parent_id;
      if ((media !== undefined && !nativeId(media)) || (parent !== undefined && !nativeId(parent))) fail();
      add(change.field === 'comments' ? 'comment' : 'mention', change,
        typeof entry.time === 'number' ? entry.time * 1000 : null, {
          native_id: id, subject_ref: ref(v.from?.id), media_id: media || null, parent_id: parent || null,
          // Missing parent is NOT proof of root. Never merge a public comment into a DM.
          relation_state: 'unresolved',
        });
    }
  }
  return { rows, ignored };
}

export function createInstagramObserverHandler({ getDb, env = () => process.env }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
    let config;
    try { config = instagramObserverConfig(env()); } catch { return res.status(503).json({ error: 'observer_unavailable' }); }
    if (!config) return res.status(404).json({ error: 'disabled' });
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q['hub.mode'] !== 'subscribe' || !equal(q['hub.verify_token'], config.verify)
        || typeof q['hub.challenge'] !== 'string' || !/^[0-9]{1,64}$/.test(q['hub.challenge']))
        return res.status(403).json({ error: 'verification_denied' });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(q['hub.challenge']);
    }
    let raw, normalized;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length; if (size > MAX_IG_BYTES) fail(413); chunks.push(bytes);
      }
      raw = Buffer.concat(chunks);
      if (!verifyInstagramSignature(raw, req.headers?.['x-hub-signature-256'], config.secret))
        return res.status(401).json({ error: 'invalid_signature' });
      if (typeof req.headers?.['content-type'] !== 'string' || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'])) fail(415);
      normalized = normalizeInstagramObservations(JSON.parse(raw.toString('utf8')), config);
    } catch (e) { return res.status(e.http || 400).json({ error: e.http === 403 ? 'scope_denied' : 'invalid_payload' }); }
    try {
      const db = await getDb();
      const { data, error } = await db.rpc('observe_instagram_dev_v1', {
        p_account_id: config.account, p_receipt_key: hash(raw), p_events: normalized.rows,
      });
      if (error || data?.durable !== true || !Number.isInteger(data.inserted) || !Number.isInteger(data.duplicates)
        || data.inserted < 0 || data.duplicates < 0 || data.inserted + data.duplicates !== normalized.rows.length) throw new Error('not_durable');
      return res.status(200).json({ observerOnly: true, inserted: data.inserted, duplicates: data.duplicates, ignored: normalized.ignored });
    } catch { return res.status(503).json({ error: 'observation_not_persisted' }); }
  };
}
