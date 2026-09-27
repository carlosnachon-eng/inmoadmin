import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { externalPaymentHandler, publicPayment, paymentUnavailable, bankUnavailable } from '../lib/server/externalPayment.mjs'
import { proofHandler, proofExtension, MAX_PROOF_BYTES } from '../supabase/functions/blindaje-payment-proof/handler.mjs'
const token = 'a'.repeat(43)
const hash = value => createHash('sha256').update(value).digest('hex')
function dbFixture(overrides = {}) {
  const tables = {
    blindaje_case_access_tokens: [{ id: 'access', case_id: 'case', expires_at: '2099-01-01', revoked_at: null }],
    blindaje_external_cases: [{ id: 'case', folio: 'BL-2026-000001', status: 'awaiting_payment' }],
    blindaje_investigation_payments: [{ id: 'payment', status: 'pending', proof_storage_path: null }],
    cuentas_bancarias: [{ banco: 'I2A-QA bank', titular: 'I2A-QA holder', clabe: '000000000000000000' }], ...overrides,
  }
  const writes = [], calls = [], objects = new Map(), removed = []
  let rpcResult = { data: 'BL-2026-000001' }
  return { tables, writes, calls, objects, removed, setRpc: value => { rpcResult = value },
    from(table) {
      let write = null, single = false
      const query = { select() { return this }, eq() { return this }, limit() { return this },
        maybeSingle() { single = true; return this }, single() { single = true; return this },
        insert(value) { write = { table, value, kind: 'insert' }; return this }, update(value) { write = { table, value, kind: 'update' }; return this },
        then(resolve, reject) { if (write) writes.push(write); return Promise.resolve({ data: single ? tables[table]?.[0] || null : tables[table] || [], error: null }).then(resolve, reject) },
      }; return query
    },
    async rpc(name, args) { calls.push({ name, args }); return rpcResult },
    storage: { from(bucket) { assert.equal(bucket, 'blindaje-payment-proofs'); return {
      async upload(path, bytes, options) { assert.equal(options.upsert, false); objects.set(path, bytes); return { data: {} } },
      async remove(paths) { for (const path of paths) { removed.push(path); objects.delete(path) }; return { data: {} } },
    } } },
  }
}
async function endpoint(kind, body, db = dbFixture(), enabled = true, method = 'POST') {
  let status, result; const headers = {}
  const res = { setHeader(key, val) { headers[key] = val }, status(value) { status = value; return this }, json(value) { result = value; return this } }
  await externalPaymentHandler(kind, () => db, () => enabled)({ method, body }, res)
  return { status, body: result, headers, db }
}
test('flag OFF denies every new Vercel endpoint before accessing DB', async () => {
  for (const kind of ['claim','b2c','partner','public']) assert.equal((await endpoint(kind, {}, { from() { throw Error('DB touched') } }, false)).status, 404)
})
test('claim: 256 bits, hash-only persistence, 2 hour lifetime, roles strict', async () => {
  for (const role of ['inquilino','propietario']) {
    const r = await endpoint('claim', { role })
    assert.equal(r.status, 201); assert.equal(Buffer.from(r.body.token, 'base64url').length, 32)
    assert.equal(r.body.claim_hash, hash(r.body.token)); assert.equal(r.db.writes[0].value.token_hash, hash(r.body.token))
    assert.ok(Math.abs(new Date(r.body.expires_at) - Date.now() - 7200000) < 5000)
    assert.ok(!JSON.stringify(r.db.writes).includes(r.body.token))
  }
  assert.equal((await endpoint('claim', { role: 'admin' })).status, 400)
})
test('B2C never accepts record_id; RPC gets only hashes and role', async () => {
  assert.equal((await endpoint('b2c', { token, role: 'inquilino', record_id: 'known-uuid' })).status, 404)
  const r = await endpoint('b2c', { token, role: 'inquilino' })
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.body).sort(), ['folio','payment_token'])
  assert.equal(r.db.calls[0].args.p_hash, hash(token)); assert.equal(r.db.calls[0].args.p_payment_hash, hash(r.body.payment_token))
  assert.equal(Buffer.from(r.body.payment_token, 'base64url').length, 32)
})
test('Partner uses only invitation credential; fail closed on failed atomic validation', async () => {
  const r = await endpoint('partner', { invitation_token: token })
  assert.equal(r.db.calls[0].args.p_kind, 'partner'); assert.equal(r.db.calls[0].args.p_role, null)
  const db = dbFixture(); db.setRpc({ data: null })
  assert.deepEqual((await endpoint('partner', { invitation_token: token }, db)).body, { error: paymentUnavailable })
  assert.equal((await endpoint('partner', { invitation_token: token, partner_operation_id: 'known' })).status, 404)
})
for (const mode of ['invented','expired','revoked']) test(`payment token ${mode}: uniform failure`, async () => {
  const db = dbFixture({ blindaje_case_access_tokens: mode === 'invented' ? [] : [{ case_id: 'case', expires_at: mode === 'expired' ? '2000-01-01' : '2099-01-01', revoked_at: mode === 'revoked' ? '2026-01-01' : null }] })
  const r = await endpoint('public', { token }, db)
  assert.equal(r.status, 404); assert.deepEqual(r.body, { error: paymentUnavailable })
})
for (const count of [0,1,2]) test(`bank exact cardinality ${count}`, async () => {
  const db = dbFixture({ cuentas_bancarias: Array.from({ length: count }, () => ({ banco: 'I2A-QA', titular: 'I2A-QA', clabe: '000000000000000000' })) })
  const r = await endpoint('public', { token }, db)
  assert.equal(r.status, count === 1 ? 200 : 503)
  if (count !== 1) assert.deepEqual(r.body, { error: bankUnavailable })
})
test('public projection excludes all record ids, PII, storage and payer metadata', async () => {
  const r = await endpoint('public', { token })
  assert.deepEqual(r.body, { folio: 'BL-2026-000001', amount: 1000, currency: 'MXN', status: 'pending', bank: { banco: 'I2A-QA bank', titular: 'I2A-QA holder', clabe: '000000000000000000' } })
  assert.equal(r.headers['Cache-Control'], 'no-store'); assert.equal(r.headers['Referrer-Policy'], 'no-referrer')
})
const fixtures = { 'application/pdf': new TextEncoder().encode('%PDF-1.4\nI2A-QA'), 'image/jpeg': new Uint8Array([255,216,255,224,0,0]), 'image/png': new Uint8Array([137,80,78,71,13,10,26,10,0]) }
function request(bytes = fixtures['application/pdf'], mime = 'application/pdf', headers = {}) {
  return new Request('https://example.test/functions/v1/blindaje-payment-proof', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime, 'X-Payer-Role': 'tercero', 'X-Payer-Name': 'I2A-QA', 'X-File-Name': 'I2A-QA.pdf', ...headers }, body: bytes })
}
for (const [mime, bytes] of Object.entries(fixtures)) test(`proof actual bytes accepted: ${mime}`, async () => {
  const db = dbFixture(); db.setRpc({ data: true })
  const r = await proofHandler(() => db)(request(bytes, mime))
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'proof_received' })
  const [path] = db.objects.keys(); assert.match(path, /^cases\/case\/investigation\/payment\/[0-9a-f-]+\.(pdf|jpg|png)$/)
  assert.ok(!path.includes('I2A-QA')); assert.equal(db.calls[0].args.p_hash, hash(token))
})
test('proof exactly 5 MB is accepted, 5 MB + 1 is denied using real buffer length', async () => {
  for (const size of [MAX_PROOF_BYTES, MAX_PROOF_BYTES+1]) {
    const bytes = new Uint8Array(size); bytes.set(fixtures['application/pdf'])
    const db = dbFixture(); db.setRpc({ data: true })
    const r = await proofHandler(() => db)(request(bytes))
    assert.equal(r.status, size === MAX_PROOF_BYTES ? 200 : 400)
    if (size > MAX_PROOF_BYTES) assert.equal(db.objects.size, 0)
  }
})
test('false MIME, false magic, third party without name fail before upload', async () => {
  for (const req of [request(fixtures['application/pdf'], 'image/png'), request(new Uint8Array([1,2,3]), 'application/pdf'), request(fixtures['application/pdf'], 'text/plain'), request(fixtures['application/pdf'], 'application/pdf', { 'X-Payer-Name': '' })]) {
    const db = dbFixture(); assert.equal((await proofHandler(() => db)(req)).status, 400); assert.equal(db.objects.size, 0)
  }
})
test('replacement removes previous object only after successful commit', async () => {
  const db = dbFixture({ blindaje_investigation_payments: [{ id: 'payment', status: 'proof_received', proof_storage_path: 'previous' }] }); db.setRpc({ data: true }); db.objects.set('previous', new Uint8Array())
  assert.equal((await proofHandler(() => db)(request())).status, 200)
  assert.deepEqual(db.removed, ['previous']); assert.equal(db.objects.size, 1)
  assert.equal(db.calls[0].args.p_expected_path, 'previous')
})
test('CAS conflict removes only uncommitted new upload and preserves old proof', async () => {
  const db = dbFixture({ blindaje_investigation_payments: [{ id: 'payment', status: 'proof_received', proof_storage_path: 'previous' }] }); db.setRpc({ data: false }); db.objects.set('previous', new Uint8Array())
  assert.equal((await proofHandler(() => db)(request())).status, 409)
  assert.equal(db.objects.size, 1); assert.ok(db.objects.has('previous')); assert.ok(!db.removed.includes('previous'))
})
for (const mode of ['invented','expired','revoked']) test(`proof ${mode} credential is rejected before any storage writes`, async () => {
  const db = dbFixture({ blindaje_case_access_tokens: mode === 'invented' ? [] : [{ expires_at: mode === 'expired' ? '2000-01-01' : '2099-01-01', revoked_at: mode === 'revoked' ? '2026-01-01' : null }] })
  assert.equal((await proofHandler(() => db)(request())).status, 404); assert.equal(db.objects.size, 0)
})
test('API failures never leak database details', async () => {
  const db = dbFixture(); db.setRpc({ error: { message: 'secret ids and bearer' } })
  const r = await endpoint('b2c', { token, role: 'inquilino' }, db)
  assert.equal(r.status, 503); assert.ok(!JSON.stringify(r.body).includes('secret'))
})

test('oversized Content-Length drains without retaining the request body', async () => {
  const db = dbFixture()
  const req = request(fixtures['application/pdf'], 'application/pdf', { 'Content-Length': String(MAX_PROOF_BYTES+1) })
  assert.equal((await proofHandler(() => db)(req)).status, 400)
  assert.equal(db.objects.size, 0); assert.equal(req.bodyUsed, true)
})

test('I2B rejected proof can be replaced; validated payment never uploads', async () => {
  for (const [paymentStatus,caseStatus,expected] of [['rejected','payment_rejected',200],['validated','payment_validated',404]]) {
    const db=dbFixture({blindaje_external_cases:[{id:'case',status:caseStatus}],blindaje_investigation_payments:[{id:'payment',status:paymentStatus,proof_storage_path:'previous'}]})
    db.setRpc({data:true});db.objects.set('previous',new Uint8Array())
    assert.equal((await proofHandler(()=>db)(request())).status,expected)
    if(expected===200) assert.deepEqual(db.removed,['previous'])
    else {assert.equal(db.calls.length,0);assert.deepEqual(db.removed,[])}
  }
})
