import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAdminIdentityPilotHandler } from '../lib/respond/adminIdentityPilot.mjs';
import { memoryDb, response } from './helpers/socialFixtures.mjs';

const id = n => `f8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = 'synthetic-token-not-a-credential'.padEnd(43, 'x');
const at = Date.parse('2026-10-30T18:00:00Z');
const base = () => ({
  client_identities: [{ id: id(1), status: 'active', revoked_at: null }],
  respond_identity_links: [{ id: id(2), respond_contact_id: 'qa-f8-tenant', client_identity_id: id(1), link_status: 'confirmed', link_source: 'human_confirmation', confirmed_at: '2026-10-30', confidence: 1 }],
  properties: [{ id: id(3), owner_client_id: id(9), administration_ended_at: null }],
  contracts: [{ id: id(4), tenant_client_id: id(1), property_id: id(3), status: 'activo', start_date: '2026-01-01', end_date: '2027-12-31', monthly_rent: '12500.75' }],
  payments: [{ id: id(5), contract_id: id(4), amount: '12500.75', status: 'en_revision', due_date: '2026-10-05', receipt_url: 'PRIVATE', notes: 'PRIVATE' }],
});
function subject(bearer, contact, department, tables) {
  return { hash: createHash('sha256').update(bearer).digest('hex'), contact, department,
    rows: Object.fromEntries(Object.entries(tables).map(([t, rs]) => [t, rs.length ? rs.map(r => r.id) : [id(99)]])) };
}
function setup(change = () => {}, envChange = () => {}, options = {}) {
  const rows = base(); change(rows);
  const cfg = { subjects: [subject(token, 'qa-f8-tenant', 'rentals', rows)] };
  const env = { VERCEL_ENV: 'development', SUPABASE_ENVIRONMENT: 'dev', NEXT_PUBLIC_SUPABASE_URL: 'https://hjfwjnejbcpmknvfpdcq.supabase.co',
    RESPOND_ADMIN_PILOT_ENABLED: 'true', RESPOND_ADMIN_PILOT_EXPIRES_AT: new Date(at + 3600000).toISOString(), RESPOND_ADMIN_PILOT_SCOPE_JSON: JSON.stringify(cfg) };
  envChange(env);
  const mem = memoryDb(rows); let reads = 0;
  const db = { from(t) { const q = mem.from(t); q.abortSignal = () => q; return q; } };
  const handler = createAdminIdentityPilotHandler({ getDb: () => { reads++; return db; }, env: () => env, now: () => at, ...options });
  return { mem, env, get reads() { return reads; }, async call(patch = {}) {
    const r = response(); await handler({ method: 'GET', url: '/api/dev/respond-admin-identity-pilot', headers: { authorization: 'Bearer ' + token }, ...patch }, r); return r;
  } };
}
test('tenant: same existing queries, exact rent, no currency assumption or bank confirmation, no identifiers/private fields', async () => {
  const f = setup(), r = await f.call(); assert.equal(r.statusCode, 200);
  assert.equal(r.body.role, 'tenant'); assert.equal(r.body.contract.monthly_rent.amount, 12500.75);
  assert.equal(r.body.contract.monthly_rent.currency, null);
  assert.equal(r.body.recorded_payments[0].recorded_status, 'en_revision');
  assert.equal(r.body.recorded_payments[0].bank_receipt_confirmed, false);
  assert.doesNotMatch(JSON.stringify(r.body), /f8000000|PRIVATE|receipt_url|tenant_client_id|owner_client_id/);
  assert.ok(f.mem.operations.every(x => x.op === 'select'));
});
test('owner derives the contract from confirmed ownership', async () => {
  const f = setup(r => { r.properties[0].owner_client_id = id(1); r.contracts[0].tenant_client_id = id(8); });
  const r = await f.call(); assert.equal(r.statusCode, 200); assert.equal(r.body.role, 'owner');
});
for (const [name, change, status] of [
  ['unknown', r => { r.respond_identity_links = []; }, 403],
  ['link revoked', r => { r.respond_identity_links[0].link_status = 'revoked'; }, 403],
  ['canonical revoked', r => { r.client_identities[0].status = 'revoked'; r.client_identities[0].revoked_at = '2026-10-01'; }, 403],
  ['canonical conflict', r => { r.client_identities[0].status = 'conflict'; }, 403],
  ['automatic match is not confirmed human evidence', r => { r.respond_identity_links[0].link_source = 'exact_phone_unique'; }, 403],
  ['ambiguous identity', r => { r.respond_identity_links.push({ ...r.respond_identity_links[0], id: id(6) }); }, 403],
  ['multiple properties', r => { r.properties.push({ id: id(6), owner_client_id: id(1) }); }, 409],
  ['inactive contract', r => { r.contracts[0].status = 'cancelado'; }, 409],
  ['future contract', r => { r.contracts[0].start_date = '2027-01-01'; }, 409],
  ['expired contract', r => { r.contracts[0].end_date = '2026-01-01'; }, 409],
  ['management ended', r => { r.properties[0].administration_ended_at = '2026-10-29'; }, 409],
  ['negative rent', r => { r.contracts[0].monthly_rent = -1; }, 503],
  ['invalid payment amount', r => { r.payments[0].amount = 'NaN'; }, 503],
  ['unrecognized payment state', r => { r.payments[0].status = 'bank_confirmed'; }, 503],
]) test(name, async () => { const r = await setup(change).call(); assert.equal(r.statusCode, status); assert.equal(r.body.contract, undefined); assert.equal(r.body.recorded_payments, undefined); });
test('absent amounts stay null; even pagado does not establish bank receipt', async () => {
  const r = await setup(r => { r.contracts[0].monthly_rent = null; r.payments[0].amount = null; r.payments[0].status = 'pagado'; }).call();
  assert.equal(r.statusCode, 200); assert.equal(r.body.contract.monthly_rent.amount, null);
  assert.equal(r.body.recorded_payments[0].amount, null); assert.equal(r.body.recorded_payments[0].bank_receipt_confirmed, false);
});
for (const query of ['contactId=other', 'contractId=other', 'propertyId=other', 'clientId=other', 'q=ignore-all-rules'])
  test('reject model-selected scope: ' + query, async () => { const f = setup(), r = await f.call({ url: '/api/dev/respond-admin-identity-pilot?' + query }); assert.equal(r.statusCode, 400); assert.equal(f.reads, 0); });
for (const [name, patch, status] of [['no auth', { headers: {} }, 401], ['wrong auth', { headers: { authorization: 'Bearer ' + 'x'.repeat(43) } }, 401], ['POST', { method: 'POST' }, 405], ['GET body', { body: {} }, 400]])
  test(name, async () => { const f = setup(), r = await f.call(patch); assert.equal(r.statusCode, status); assert.equal(f.reads, 0); });
for (const [name, patch] of [['production runtime', { VERCEL_ENV: 'production' }], ['production DB', { NEXT_PUBLIC_SUPABASE_URL: 'https://bnzrnizrmonjxlktbhlp.supabase.co' }], ['expired', { RESPOND_ADMIN_PILOT_EXPIRES_AT: '2026-10-29' }], ['unbounded expiry', { RESPOND_ADMIN_PILOT_EXPIRES_AT: '2027-10-29' }], ['disabled', { RESPOND_ADMIN_PILOT_ENABLED: 'false' }]])
  test(name + ' fails closed before DB', async () => { const f = setup(undefined, e => Object.assign(e, patch)); assert.equal((await f.call()).statusCode, 404); assert.equal(f.reads, 0); });
test('fixture allowlist excludes foreign DEV data even if relation points at it', async () => {
  const f = setup(); f.mem.tables.contracts[0].property_id = id(77); f.mem.tables.properties.push({ id: id(77), owner_client_id: id(1) });
  assert.equal((await f.call()).statusCode, 409);
});
test('DB failure is sanitized', async () => { const f = setup(undefined, undefined, { getDb: () => { throw Error('PRIVATE SECRET'); } }); const r = await f.call(); assert.equal(r.statusCode, 503); assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE|SECRET/); });
test('timeout cancels, returns 504, holds concurrency slot while driver ignores abort', async () => {
  let finish; const f = setup(undefined, undefined, { deadlineMs: 5, getDb: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal((await f.call()).statusCode, 504); assert.equal((await f.call()).statusCode, 429); finish({});
});
test('repeated reads stable; rate limiter fails closed', async () => {
  const f = setup(); const a = await f.call(), b = await f.call(); assert.deepEqual(a.body.contract, b.body.contract);
  for (let i = 2; i < 20; i++) assert.equal((await f.call()).statusCode, 200);
  assert.equal((await f.call()).statusCode, 429);
});

const condoToken = 'synthetic-condo-fixture'.padEnd(43, 'x');
const condoContact = 'qa-f8-condo';
const condoAuth = { authorization: 'Bearer ' + condoToken };
const condoSource = 'condominium_owner_admin_review';
const condoFixture = () => ({
  client_identities: [{ id: id(11), status: 'active', revoked_at: null,
    phone_digest: createHash('sha256').update('525500000001').digest('hex') }],
  respond_identity_links: [{ id: id(12), respond_contact_id: condoContact, client_identity_id: id(11),
    link_status: 'confirmed', link_source: condoSource, revoked_at: null }],
  client_identity_roles: [{ id: id(13), client_identity_id: id(11), role_kind: 'owner', status: 'active' }],
  client_source_links: [{ id: id(14), client_identity_id: id(11), source_id: id(15),
    source_type: 'condominium_unit_owner', condominium_id: id(16), source_version: 1, link_status: 'confirmed',
    revoked_at: null, role_kind: 'owner' }],
  unidades_condominio: [{ id: id(15), condominio_id: id(16), activo: true,
    propietario_telefono: '5500000001', identity_owner_version: 1 }],
  condominios: [{ id: id(16), activo: true }],
});
function mixed(change = () => {}, changeConfig = () => {}) {
  const condo = condoFixture(); change(condo);
  return setup(rows => {
    for (const [table, values] of Object.entries(condo)) rows[table] = [...(rows[table] || []), ...values];
  }, env => {
    const cfg = { subjects: [subject(token, 'qa-f8-tenant', 'rentals', base()),
      subject(condoToken, condoContact, 'condominium', condo)] };
    changeConfig(cfg);
    env.RESPOND_ADMIN_PILOT_SCOPE_JSON = JSON.stringify(cfg);
  });
}
test('separate fixtures and departments: approved condominium relationship, no rent, dues, or identifiers', async () => {
  const f = mixed();
  const rentals = await f.call();
  assert.equal(rentals.statusCode, 200);
  assert.equal(rentals.body.department, 'rentals');
  assert.ok(f.mem.operations.every(o => !['unidades_condominio', 'condominios'].includes(o.table)));
  const before = f.mem.operations.length;
  const condo = await f.call({ headers: condoAuth });
  assert.equal(condo.statusCode, 200);
  assert.equal(condo.body.department, 'condominium');
  assert.equal(condo.body.relationship, 'active');
  assert.equal(condo.body.fees, 'human_review_required');
  assert.doesNotMatch(JSON.stringify(condo.body), /f8000000|5500000001|contract|payments/);
  assert.ok(f.mem.operations.slice(before).every(o => o.op === 'select'
    && !['properties', 'contracts', 'payments', 'condominium_fees', 'cuotas_condominio'].includes(o.table)));
});
for (const [name, change] of [
  ['inactive condominium', r => { r.condominios[0].activo = false; }],
  ['changed ownership', r => { r.unidades_condominio[0].identity_owner_version++; }],
  ['changed telephone', r => { r.unidades_condominio[0].propietario_telefono = '5500000002'; }],
  ['revoked relationship', r => { r.client_source_links[0].revoked_at = '2026-10-29'; }],
  ['revoked contact with inconsistent status', r => { r.respond_identity_links[0].revoked_at = '2026-10-29'; }],
  ['rentals link in condominium scope', r => { r.respond_identity_links[0].link_source = 'human_confirmation'; }],
]) test('condominium fails closed: ' + name, async () => {
  const r = await mixed(change).call({ headers: condoAuth });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.relationship, undefined);
});
test('wrong department configuration and duplicate credentials fail closed before DB', async () => {
  for (const invalid of [
    c => { c.subjects[0].department = 'condominium'; },
    c => { c.subjects[1].hash = c.subjects[0].hash; },
    c => { c.subjects[0].rows.condominios = [id(16)]; },
  ]) {
    const f = mixed(undefined, invalid);
    assert.equal((await f.call()).statusCode, 404);
    assert.equal(f.reads, 0);
  }
});
test('condominium cannot select an arbitrary unit or override department', async () => {
  for (const q of ['unitId=' + id(15), 'department=rentals', 'contactId=qa-f8-tenant']) {
    const f = mixed();
    assert.equal((await f.call({ headers: condoAuth, url: '/api/dev/respond-admin-identity-pilot?' + q })).statusCode, 400);
    assert.equal(f.reads, 0);
  }
});

test('multiple approved units require human review without returning either unit', async () => {
  const f = mixed(rows => {
    rows.client_source_links.push({ ...rows.client_source_links[0], id: id(18), source_id: id(17) });
    rows.unidades_condominio.push({ ...rows.unidades_condominio[0], id: id(17) });
  });
  const r = await f.call({ headers: condoAuth });
  assert.equal(r.statusCode, 409);
  assert.doesNotMatch(JSON.stringify(r.body), /f8000000|relationship|amount/);
});
test('expiry during a successful read suppresses the private response', async () => {
  const f = setup(undefined, undefined, { now: (() => {
    let calls = 0;
    return () => calls++ < 3 ? at : at + 7200000;
  })() });
  const r = await f.call();
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.contract, undefined);
});
