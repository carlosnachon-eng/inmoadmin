import test from 'node:test'
import assert from 'node:assert/strict'
import { invitationHandler, tokenHash, unavailable } from '../lib/server/partnerInvitations.mjs'
const operationId = '11111111-1111-4111-8111-111111111111'
const recordId = '22222222-2222-4222-8222-222222222222'
const token = 'a'.repeat(43)
function database(overrides = {}) {
  const state = { user: { id: 'user-a' }, member: { partner_agency_id: 'agency-a', active: true },
    agency: { status: 'activo', nombre_comercial: 'I2A Agencia', logo_url: null, brand_color: '#123456', id: 'secret-agency' },
    operation: { id: operationId, partner_agency_id: 'agency-a', direccion_inmueble: 'I2A Dirección', monto_renta: 12345, nombre_propietario: 'I2A Propietario', nombre_inquilino: 'I2A Inquilino', private: 'never' },
    invitation: { id: 'secret-invitation', partner_agency_id: 'agency-a', partner_operation_id: operationId, role: 'inquilino', expires_at: '2099-01-01', revoked_at: null }, rpcResult: true, ...overrides }
  const calls = []
  const db = { calls, state, auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: state.rpcResult } },
    from(table) {
      const call = { table, filters: [] }; calls.push(call)
      const q = {
        select() { return q }, eq(k,v) { call.filters.push([k,v]); return q }, is(k,v) { call.filters.push([k,v]); return q },
        insert(data) { call.insert = data; return q }, update(data) { call.update = data; return q },
        maybeSingle() { return q },
        then(resolve, reject) {
          let data = table === 'partner_users' ? state.member : table === 'partner_agencies' ? state.agency : table === 'partner_operations' ? state.operation : state.invitation
          if (table === 'partner_operations' && call.filters.some(([k,v]) => k === 'partner_agency_id' && v !== state.operation?.partner_agency_id)) data = null
          if (table === 'blindaje_partner_invitations' && call.filters.some(([k,v]) => k === 'token_hash' && v !== tokenHash(token))) data = null
          return Promise.resolve({ data, error: state.error || null }).then(resolve,reject)
        },
      }; return q
    },
  }; return db
}
async function request(kind, { db = database(), body = {}, auth = 'Bearer session', method = 'POST', enabled = true } = {}) {
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v }, status(code) { this.code=code;return this }, json(value) { this.body=value;return this } }
  await invitationHandler(kind, () => db, () => enabled)({ method, body, headers: { authorization: auth } }, res)
  return { ...res, db }
}
test('authenticated A creates random 256-bit invitation; only SHA256 stored; expires in 30 days', async () => {
  const r = await request('manage', { body: { operation_id: operationId, role: 'inquilino' } })
  assert.equal(r.code,201); assert.match(r.body.token,/^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.from(r.body.token,'base64url').length,32)
  const insert = r.db.calls.find(c=>c.insert).insert
  assert.equal(insert.token_hash,tokenHash(r.body.token)); assert.ok(!JSON.stringify(insert).includes(r.body.token))
  assert.ok(Math.abs(Date.parse(insert.expires_at)-Date.now()-30*86400000)<2000)
  assert.equal(r.headers['Cache-Control'],'no-store')
})
for (const [name, overrides, code] of [['no session',{},401],['invalid session',{ user:null },401],['inactive member',{member:{ active:false }},403],['no member',{member:null},403],['inactive agency',{agency:{status:'inactivo'}},403],['other agency',{operation:{id:operationId,partner_agency_id:'agency-b'}},404]]) {
  test(name,async()=>{const r=await request('manage',{db:database(overrides),body:{operation_id:operationId,role:'inquilino'},...(name==='no session'?{auth:''}:{})});assert.equal(r.code,code);assert.equal(r.db.calls.some(c=>c.insert),false)})
}
for (const role of ['inquilino', 'propietario']) test(`public ${role}: exact allowlist excludes the other party name`, async () => {
  const db = database(); db.state.invitation.role = role
  const r = await request('public', { db, body: { token } }); assert.equal(r.code, 200)
  assert.deepEqual(r.body, { valid: true, role,
    agency: { nombre_comercial: 'I2A Agencia', logo_url: null, brand_color: '#123456' },
    operation: { direccion_inmueble: 'I2A Dirección', monto_renta: 12345,
      ...(role === 'inquilino' ? { nombre_inquilino: 'I2A Inquilino' } : { nombre_propietario: 'I2A Propietario' }) } })
  const forbidden = role === 'inquilino' ? 'nombre_propietario' : 'nombre_inquilino'
  assert.equal(Object.hasOwn(r.body.operation, forbidden), false)
  assert.equal(JSON.stringify(r.body).includes(forbidden), false)
})
for(const mode of ['invented','malformed','expired','revoked','missing operation','inactive agency']) test(`public ${mode} uniform failure`,async()=>{
  const db=database();if(mode==='expired')db.state.invitation.expires_at='2000-01-01';if(mode==='revoked')db.state.invitation.revoked_at='2026-01-01';if(mode==='missing operation')db.state.operation=null;if(mode==='inactive agency')db.state.agency.status='inactivo'
  const r=await request('public',{db,body:{token:mode==='invented'?'b'.repeat(43):mode==='malformed'?{}:token}})
  assert.equal(r.code,404);assert.deepEqual(r.body,{error:unavailable})
})
test('wrong role never calls linking transaction',async()=>{const r=await request('link',{body:{token,tipo:'propietario',record_id:recordId}});assert.equal(r.code,404);assert.equal(r.db.calls.some(c=>c.rpc),false)})
test('link delegates hash/role/record to atomic revalidation, never IDs from body',async()=>{const r=await request('link',{body:{token,tipo:'inquilino',record_id:recordId,operation_id:'attack'}});assert.equal(r.code,200);assert.deepEqual(r.db.calls.find(c=>c.rpc).args,{p_token_hash:tokenHash(token),p_tipo:'inquilino',p_record_id:recordId})})
test('transaction rejection is uniform',async()=>{const r=await request('link',{db:database({rpcResult:false}),body:{token,tipo:'inquilino',record_id:recordId}});assert.equal(r.code,404);assert.deepEqual(r.body,{error:unavailable})})
test('revocation constrained to authenticated agency operation and role',async()=>{const r=await request('manage',{method:'DELETE',body:{operation_id:operationId,role:'propietario'}});assert.equal(r.code,200);assert.deepEqual(r.db.calls.find(c=>c.update).filters,[['partner_operation_id',operationId],['partner_agency_id','agency-a'],['role','propietario'],['revoked_at',null]])})
test('cross-agency revocation rejected',async()=>{const r=await request('manage',{db:database({operation:{id:operationId,partner_agency_id:'agency-b'}}),method:'DELETE',body:{operation_id:operationId,role:'inquilino'}});assert.equal(r.code,404);assert.equal(r.db.calls.some(c=>c.update),false)})
test('flag OFF has no DB access',async()=>{const r=await request('public',{enabled:false,body:{token}});assert.equal(r.code,404);assert.equal(r.db.calls.length,0)})
test('GET token unsupported; no-store',async()=>{const r=await request('public',{method:'GET',body:{token}});assert.equal(r.code,405);assert.equal(r.db.calls.length,0);assert.equal(r.headers['Cache-Control'],'no-store')})
test('database errors sanitized',async()=>{const r=await request('public',{db:database({error:{message:'secret SQL'}}),body:{token}});assert.equal(r.code,503);assert.ok(!JSON.stringify(r.body).includes('secret SQL'))})
