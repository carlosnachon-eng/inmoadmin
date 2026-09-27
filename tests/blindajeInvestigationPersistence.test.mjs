import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { externalInvestigationGate } from '../lib/server/polizaInternalAuth.mjs'

const require = createRequire(import.meta.url)
const { transform } = require('next/dist/build/swc')
const { code } = await transform(readFileSync(new URL('../pages/api/analizar-solicitud.js', import.meta.url), 'utf8'), {
  filename: 'analizar-solicitud.js', jsc: { parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' },
})
const id = '11111111-1111-4111-8111-111111111111'
const document = 'data:application/pdf;base64,STJCLVFBIHN5bnRoZXRpYw=='
const curp = { valido: true, nombre_en_renapo: 'I2B QA', curp_status: 'vigente', alertas: [] }
function fixture({ origin = 'partner', documents = false, providerError = false, saveError = false } = {}) {
  const row = { origen_operacion: origin, pre_viabilidad: null, nombre_completo: 'I2B QA', monto_renta_solicitada: 10000,
    ...(documents ? { doc_comprobante_ingresos_b64: document, doc_identificacion_b64: document, curp: 'I2B-QA' } : {}) }
  const tables = {
    profiles: { id, role_id: 'juridico', active: true, full_name: 'I2B QA', roles: { es_externo: false } },
    permisos_modulo: { puede_ver: true, puede_editar: true },
    blindaje_external_cases: { id, status: 'payment_validated' },
    blindaje_investigation_payments: { id, status: 'validated' },
    blindaje_investigation_ledger_entries: { poliza_caja_id: id },
    poliza_caja: { id, tipo: 'ingreso', concepto: 'investigacion', monto: 1000 },
  }
  const accountingBefore = structuredClone(tables)
  const writes = [], calls = []
  const db = {
    auth: { getUser: async () => ({ data: { user: { id } } }) },
    from(table) {
      let patch
      const q = { select() { return q }, eq() { return q }, single() { return q }, maybeSingle() { return q },
        update(value) { patch = value; return q },
        then(resolve, reject) {
          if (patch) {
            assert.equal(table, 'solicitudes_inquilino')
            writes.push(structuredClone(patch))
            if (!saveError) Object.assign(row, patch)
          }
          return Promise.resolve({ data: table === 'solicitudes_inquilino' ? { ...row } : tables[table],
            error: patch && saveError ? { message: 'synthetic storage failure' } : null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const fetchMock = async (url, options) => {
    calls.push(url)
    if (url.endsWith('/api/validar-curp')) return { ok: true, json: async () => curp }
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    if (providerError) return { ok: false, status: 503, text: async () => 'I2B-QA provider unavailable' }
    const input = { documento_legible: true, nombre_en_documentos: 'I2B QA', nombre_coincide: true,
      ingreso_mensual_verificable: 50000, ingreso_mensual_total: 55000, alertas: [], tipo_documento: 'nomina' }
    const body = JSON.parse(options.body)
    return { ok: true, json: async () => ({ content: body.tools
      ? [{ type: 'tool_use', name: 'registrar_analisis_ingresos', input }]
      : [{ type: 'text', text: JSON.stringify(input) }] }) }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'fetch', code)(name => name === '@supabase/supabase-js'
    ? { createClient: () => db } : name.includes('polizaInternalAuth') ? { externalInvestigationGate } : require(name), module, module.exports, fetchMock)
  return { row, writes, calls, tables, accountingBefore, async run(body = {}) {
    let status, payload
    await module.exports.default({ method: 'POST', headers: { authorization: 'Bearer qa-session' },
      body: { solicitud_id: id, tipo_ejecucion: 'inicial', ...body } },
    { status(v) { status = v; return this }, json(v) { payload = v } })
    return { status, payload }
  } }
}
function assertPersisted(f, response) {
  const r = response.payload
  assert.equal(response.status, 200)
  assert.equal(f.writes.length, 1)
  for (const [key, value] of Object.entries({ pre_viabilidad: r.resultado, pre_viabilidad_detalle: r.mensaje,
    pre_viabilidad_detalle_interno: r.mensajeInterno, ingreso_detectado_ia: r.detalles.ingresoDetectado,
    ingreso_total_ia: r.detalles.analisisIA?.ingreso_mensual_total ?? null })) assert.equal(f.row[key], value, key)
  assert.ok(f.row.ia_ultimo_analisis_en)
  assert.deepEqual(f.tables, f.accountingBefore)
}
for (const origin of ['b2c', 'partner']) {
  test(`${origin}: no documents is persisted manual review, accounting unchanged, retry blocked`, async () => {
    const f = fixture({ origin }), first = await f.run()
    assertPersisted(f, first)
    assert.equal(first.payload.detalles.sin_documentos, true)
    assert.equal(f.row.pre_viabilidad, 'pendiente')
    assert.equal(f.row.ia_revision_manual, true)
    assert.equal((await f.run()).status, 409)
    assert.equal(f.calls.length, 0)
    assert.equal(f.writes.length, 1)
  })
  test(`${origin}: synthetic documents persist result/incomes/CURP atomically; retry never invokes provider`, async () => {
    const f = fixture({ origin, documents: true }), first = await f.run()
    assertPersisted(f, first)
    assert.equal(f.row.pre_viabilidad, 'viable')
    assert.equal(f.row.ingreso_detectado_ia, 50000)
    assert.equal(f.row.ingreso_total_ia, 55000)
    assert.equal(f.row.curp_validada, true)
    assert.equal(f.row.curp_nombre_renapo, curp.nombre_en_renapo)
    assert.equal(f.row.curp_status, curp.curp_status)
    const calls = f.calls.length
    assert.equal(calls, 3)
    assert.equal((await f.run()).status, 409)
    assert.equal(f.calls.length, calls)
    assert.equal(f.writes.length, 1)
  })
}
test('real provider failure retains NULL result, accounting and retry', async () => {
  const f = fixture({ documents: true, providerError: true })
  assert.equal((await f.run()).status, 503)
  assert.equal(f.row.pre_viabilidad, null)
  assert.equal(f.writes.length, 0)
  const calls = f.calls.length
  assert.equal((await f.run()).status, 503)
  assert.ok(f.calls.length > calls)
  assert.deepEqual(f.tables, f.accountingBefore)
})
test('persistence failure cannot return success or consume initial analysis', async () => {
  const f = fixture({ saveError: true })
  assert.equal((await f.run()).status, 503)
  assert.equal(f.row.pre_viabilidad, null)
  assert.equal((await f.run()).status, 503)
  assert.deepEqual(f.tables, f.accountingBefore)
})
for (const origin of ['emporio', null]) test(`${origin}: legacy initial still only writes audit`, async () => {
  const f = fixture({ origin, documents: true })
  assert.equal((await f.run()).status, 200)
  assert.equal(f.row.pre_viabilidad, null)
  assert.equal(Object.hasOwn(f.writes[0], 'ingreso_detectado_ia'), false)
  assert.equal(Object.hasOwn(f.writes[0], 'curp_validada'), false)
})
test('external reanalysis retains audit-only persistence and existing actor/reason', async () => {
  const f = fixture({ documents: true })
  f.row.pre_viabilidad = 'pendiente'
  assert.equal((await f.run({ tipo_ejecucion: 'reanalisis', motivo: 'I2B-QA documento actualizado' })).status, 200)
  assert.equal(f.row.pre_viabilidad, 'pendiente')
  assert.equal(Object.hasOwn(f.writes[0], 'ingreso_detectado_ia'), false)
  assert.equal(f.row.ia_reanalizado_por, 'I2B QA')
  assert.equal(f.row.ia_reanalisis_motivo, 'I2B-QA documento actualizado')
})
