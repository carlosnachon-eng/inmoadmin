import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { readInternalContactLocation } from '../lib/poliza/contactoLocalizacionServer.js'

// Opt-in integration suite: only synthetic fixtures on the explicitly authorized DEV project.
const enabled = Boolean(process.env.BLINDAJE_QA_ACCOUNTS_FILE && process.env.BLINDAJE_QA_BASE_URL)
const expA = 'c01e0000-0000-4000-8000-000000000011'
const expB = 'c01e0000-0000-4000-8000-000000000012'
const expWithoutRequest = 'c01e0000-0000-4000-8000-000000000013'
const opA = 'c01d0000-0000-4000-8000-000000000011'
const opB = 'c01d0000-0000-4000-8000-000000000012'

test('DEV: auth real, aislamiento y proyecciones reales del lector interno', { skip: !enabled }, async t => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  assert.equal(url, 'https://hjfwjnejbcpmknvfpdcq.supabase.co', 'Never run this suite against production')
  const base = process.env.BLINDAJE_QA_BASE_URL
  assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) || /^https:\/\/inmoadmin-[a-z0-9-]+\.vercel\.app$/.test(base))
  const accounts = JSON.parse(await readFile(process.env.BLINDAJE_QA_ACCOUNTS_FILE, 'utf8'))
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const sessions = {}
  for (const [name, account] of Object.entries(accounts)) {
    assert.ok(account.email.startsWith('qa.blindaje.security.'))
    const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: account.password })
    assert.equal(error, null, `${name}: synthetic sign-in failed`)
    sessions[name] = { client, token: data.session.access_token }
  }
  const request = async (name, path) => {
    const response = await fetch(base + path, { headers: name ? { Authorization: `Bearer ${sessions[name].token}` } : {} })
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') }
  }
  const panel = (name, id = expA) => request(name, `/api/poliza/contacto-localizacion?expedienteId=${id}`)

  for (const [name, expected] of [['juridico',200], ['admin',200], ['no_profile',403], ['inactive',403], ['no_permission',403], ['propio',403], ['partner_a',403], ['partner_b',403], [null,401]]) {
    await t.test(`${name || 'sin sesion'}: ${expected}`, async () => {
      const result = await panel(name)
      assert.equal(result.status, expected)
      assert.match(result.cache, /no-store/)
      if (expected !== 200) assert.equal(result.body.location, undefined)
      else {
        assert.equal(result.body.location.referencias.length, 6)
        assert.equal(result.body.location.obligados.length, 2)
        assert.equal(result.body.location.obligados[0].denominacion, 'Aval declarado — registro histórico')
        assert.equal(result.body.location.obligados[1].denominacion, 'Obligado solidario — participante registrado')
        assert.doesNotMatch(JSON.stringify(result.body), /BODY_SENTINEL|docs_json|data_json|storage_path|doc_identificacion/)
        assert.deepEqual(Object.keys(result.body.solicitud), ['id'])
      }
    })
  }
  await t.test('Sin solicitud: participante vinculado por expediente permanece visible', async () => {
    const result = await panel('juridico', expWithoutRequest)
    assert.equal(result.status, 200)
    assert.equal(result.body.solicitud, null)
    assert.equal(result.body.location.obligados[0].nombre, 'QA Obligado Sin Solicitud')
    assert.match(result.body.pending.join(' '), /sin ID vinculado/)
  })
  await t.test('No acepta inyectar ID de solicitud, operacion o agencia', async () => {
    for (const field of ['solicitudId','operationId','agencyId']) {
      const result = await request('juridico', `/api/poliza/contacto-localizacion?expedienteId=${expA}&${field}=${expB}`)
      assert.equal(result.status, 400)
    }
    assert.equal((await panel('partner_a', expB)).status, 403)
    assert.equal((await panel('juridico', 'c01e0000-0000-4000-8000-000000000099')).status, 404)
  })
  await t.test('Partner A conserva ruta propia y no lee participantes B', async () => {
    const own = await request('partner_a', `/api/partners/participants?operation_id=${opA}`)
    assert.equal(own.status, 200)
    assert.doesNotMatch(JSON.stringify(own.body), /QA Obligado B/)
    const other = await request('partner_a', `/api/partners/participants?operation_id=${opB}`)
    assert.equal(other.status, 404)
    const direct = await sessions.partner_a.client.from('partner_participants').select('id').eq('partner_operation_id', opA)
    assert.deepEqual(direct.data, [])
  })
  await t.test('Proyecciones y respuestas Supabase reales no descargan cuerpos documentales', async () => {
    const reads = []
    const inspected = async (input, init) => {
      const u = new URL(input instanceof Request ? input.url : input)
      const response = await fetch(input, init)
      if (u.pathname.startsWith('/rest/v1/')) {
        const body = await response.clone().text()
        reads.push({ table: u.pathname.split('/').at(-1), projection: u.searchParams.get('select') })
        assert.doesNotMatch(body, /BODY_SENTINEL|storage_path|dataUrl/)
        assert.doesNotMatch(u.searchParams.get('select') || '', /\*|docs_json|doc_identificacion|doc_comprobante/)
      }
      assert.equal(u.pathname.startsWith('/storage/'), false)
      return response
    }
    const scoped = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { ...options, global: { headers: { Authorization: `Bearer ${sessions.juridico.token}` }, fetch: inspected } })
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { ...options, global: { fetch: inspected } })
    const result = await readInternalContactLocation({ scoped, service, token: sessions.juridico.token, expedienteId: expA })
    assert.equal(result.status, 200)
    assert.equal(result.body.location.obligados.length, 2)
    assert.ok(reads.some(r => r.table === 'solicitudes_inquilino'))
    assert.ok(reads.some(r => r.table === 'partner_participants'))
  })
})
