import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { loadContactLocation, buildContactLocation, SOLICITUD_FIELDS, OPERATION_FIELDS, PARTICIPANT_FIELDS } from '../lib/poliza/contactoLocalizacion.js'

const operation = {
  id: 'operation-a', partner_agency_id: 'agency-a',
  poliza_expediente_id: 'expediente-a', solicitud_inquilino_id: 'solicitud-a',
}
const participant = {
  id: 'participant-a', partner_operation_id: operation.id, partner_agency_id: operation.partner_agency_id,
  role: 'obligado_solidario', status: 'recibido', nombre: 'Obligado sintetico', telefono: '0000000000',
  data_json: { domicilio: 'Domicilio sintetico', ocupacion: 'Actividad QA', relacion_inquilino: 'Familiar', archivo: 'BODY_SENTINEL' },
  docs_json: [{ key: 'identificacion', storage_path: 'qa/no-descargar.pdf', dataUrl: 'BODY_SENTINEL' }],
}
const solicitud = {
  id: 'solicitud-a', telefono: '0000000001', correo: 'qa@example.invalid',
  domicilio_actual: 'Domicilio declarado QA', empresa_labora: 'Empresa QA',
  nombre_aval: 'Aval historico QA', telefono_aval: '0000000002',
  doc_identificacion_aval: 'BODY_SENTINEL', doc_comprobante_aval: 'BODY_SENTINEL',
  doc_identificacion_b64: 'BODY_SENTINEL',
}
for (let index = 1; index <= 3; index += 1) {
  solicitud[`ref_fam${index}_nombre`] = `Familiar ${index}`
  solicitud[`ref_fam${index}_telefono`] = `000000001${index}`
  solicitud[`ref_per${index}_nombre`] = `Personal ${index}`
  solicitud[`ref_per${index}_telefono`] = `000000002${index}`
}

// Real query serialization; synthetic PostgREST responses (not a live RLS test).
function fixture({ tables = {}, failures = {}, visible = () => true } = {}) {
  const requests = []
  const responses = []
  const rows = { solicitudes_inquilino: [solicitud], partner_operations: [operation], partner_participants: [participant], ...tables }
  const client = createClient('https://qa.invalid', 'synthetic-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input)
      const table = url.pathname.split('/').at(-1)
      const query = Object.fromEntries(url.searchParams)
      requests.push({ table, method: init.method, query })
      assert.equal(init.method, 'GET')
      assert.ok(table in rows, 'no storage/document endpoint or additional table')
      if (failures[table] === 'network') throw new Error('synthetic transport failure')
      if (failures[table]) return new Response(JSON.stringify({ message: 'synthetic permission error', code: '42501' }), { status: 403 })
      let result = rows[table].filter(row => visible(table, row))
      for (const [column, filter] of url.searchParams) {
        if (column === 'select') continue
        assert.ok(filter !== 'eq.undefined' && filter !== 'eq.null')
        if (filter.startsWith('eq.')) result = result.filter(row => row[column] === filter.slice(3))
        else if (filter.startsWith('neq.')) result = result.filter(row => row[column] !== filter.slice(4))
        else assert.fail(`unexpected filter: ${column}=${filter}`)
      }
      result = result.map(row => Object.fromEntries(query.select.split(',').map(field => {
        const [alias, expression] = field.trim().split(':')
        if (!expression) return [alias, row[alias] ?? null]
        const [json, key] = expression.split('->>')
        return [alias, row[json]?.[key] ?? null]
      })))
      responses.push({ table, data: result })
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  return { client, requests, responses }
}

test('A: expediente sin solicitud recupera obligado por operacion y agencia exactas', async () => {
  const f = fixture({ tables: { partner_operations: [{ ...operation, solicitud_inquilino_id: null }] } })
  const result = await loadContactLocation(f.client, { expedienteId: 'expediente-a' })
  assert.equal(result.location.obligados[0].nombre, participant.nombre)
  assert.match(result.pending.join(' '), /sin ID vinculado/)
  assert.equal(f.requests.some(request => request.table === 'solicitudes_inquilino'), false)
  assert.deepEqual(f.requests.at(-1).query, {
    select: PARTICIPANT_FIELDS.replaceAll(' ', ''), partner_operation_id: 'eq.operation-a',
    partner_agency_id: 'eq.agency-a', role: 'eq.obligado_solidario', status: 'neq.cancelado',
  })
})

for (const failure of ['missing', 'denied', 'network']) {
  test(`B: solicitud ${failure} no oculta participantes autorizados`, async () => {
    const f = fixture({ tables: failure === 'missing' ? { solicitudes_inquilino: [] } : {},
      failures: failure === 'missing' ? {} : { solicitudes_inquilino: failure } })
    const result = await loadContactLocation(f.client, { expedienteId: 'expediente-a', solicitudId: 'solicitud-a' })
    assert.equal(result.solicitud, null)
    assert.equal(result.location.obligados.length, 1)
    assert.equal(result.location.obligados[0].nombre, participant.nombre)
    assert.equal(result.location.principal.telefono, undefined)
    assert.ok(result.pending.length)
  })
}

test('C/D: aval historico y obligado registrado conservan denominacion y fuente', async () => {
  const f = fixture()
  const result = await loadContactLocation(f.client, { expedienteId: 'expediente-a', solicitudId: 'solicitud-a' })
  assert.deepEqual(result.location.obligados.map(row => row.denominacion), [
    'Aval declarado — registro histórico', 'Obligado solidario — participante registrado',
  ])
  assert.deepEqual(result.location.obligados.map(row => row.fuente), [
    'Solicitud original (campo histórico)', 'Participante vinculado por operación Partner',
  ])
})

test('E: proyecciones serializadas y respuestas sin cuerpos documentales ni JSON completo', async () => {
  const f = fixture()
  const result = await loadContactLocation(f.client, { expedienteId: 'expediente-a', solicitudId: 'solicitud-a' })
  const expected = { solicitudes_inquilino: SOLICITUD_FIELDS, partner_operations: OPERATION_FIELDS, partner_participants: PARTICIPANT_FIELDS }
  for (const request of f.requests) {
    assert.equal(request.query.select, expected[request.table].replaceAll(' ', ''))
    assert.doesNotMatch(request.query.select, /\*|doc_|docs_json|data_json(?:,|$)/)
  }
  for (const response of f.responses) {
    assert.doesNotMatch(JSON.stringify(response), /BODY_SENTINEL|dataUrl|storage_path|docs_json|doc_identificacion|doc_comprobante/)
  }
  assert.equal(result.location.obligados[1].domicilio, participant.data_json.domicilio)
  assert.equal(result.location.obligados[1].relacion, 'Familiar')
  assert.equal('tieneDocumentos' in result.location.obligados[0], false)
})

test('F: contactos y seis referencias; solicitud antigua por ID sin filtro de fecha', async () => {
  const f = fixture({ tables: { solicitudes_inquilino: [{ ...solicitud, created_at: '2019-01-01' }] } })
  const { location } = await loadContactLocation(f.client, { solicitudId: 'solicitud-a' })
  assert.equal(location.principal.telefono, solicitud.telefono)
  assert.equal(location.principal.correo, solicitud.correo)
  assert.equal(location.laboral.empleador, solicitud.empresa_labora)
  assert.equal(location.referencias.length, 6)
  assert.deepEqual(Object.keys(f.requests[0].query).sort(), ['id', 'select'])
})

test('F: fallo Partner conserva contactos y referencias, sin propagar error al expediente', async () => {
  const f = fixture({ failures: { partner_operations: 'network' } })
  const { location, pending } = await loadContactLocation(f.client, { solicitudId: 'solicitud-a', expedienteId: 'expediente-a' })
  assert.equal(location.referencias.length, 6)
  assert.equal(location.principal.telefono, solicitud.telefono)
  assert.match(pending.join(' '), /consulta pendiente/)
})

test('F: fallo participantes conserva solicitud y no inventa obligado Partner', async () => {
  const f = fixture({ failures: { partner_participants: 'denied' } })
  const { location, pending } = await loadContactLocation(f.client, { solicitudId: 'solicitud-a', expedienteId: 'expediente-a' })
  assert.equal(location.obligados.length, 1)
  assert.match(location.obligados[0].denominacion, /^Aval declarado/)
  assert.match(pending.join(' '), /Participantes Partner: consulta pendiente/)
})

test('sin vinculos no busca nombres ni IDs null/undefined', async () => {
  const f = fixture()
  const { location, pending } = await loadContactLocation(f.client, {})
  assert.deepEqual(f.requests, [])
  assert.deepEqual(location.obligados, [])
  assert.ok(pending.length)
})

test('no combina operacion de otro expediente aunque coincida la solicitud', async () => {
  const f = fixture({ tables: { partner_operations: [{ ...operation, poliza_expediente_id: 'otro-expediente' }] } })
  const { pending } = await loadContactLocation(f.client, { solicitudId: 'solicitud-a', expedienteId: 'expediente-a' })
  assert.match(pending.join(' '), /relación incompatible/)
  assert.equal(f.requests.some(row => row.table === 'partner_participants'), false)
})

test('dos operaciones compatibles de agencias distintas no se mezclan', async () => {
  const f = fixture({ tables: { partner_operations: [operation, { ...operation, id: 'operation-b', partner_agency_id: 'agency-b' }] } })
  const { pending } = await loadContactLocation(f.client, { solicitudId: 'solicitud-a', expedienteId: 'expediente-a' })
  assert.match(pending.join(' '), /varios vínculos posibles/)
  assert.equal(f.requests.some(row => row.table === 'partner_participants'), false)
})

test('F: otra agencia, otro rol o cancelado no llega en respuesta/modelo', async () => {
  const f = fixture({ tables: { partner_participants: [participant,
    { ...participant, id: 'foreign', partner_agency_id: 'agency-b', nombre: 'FOREIGN_SENTINEL' },
    { ...participant, id: 'cancelled', status: 'cancelado' },
    { ...participant, id: 'other-role', role: 'inquilino_adicional' },
  ] } })
  const result = await loadContactLocation(f.client, { expedienteId: 'expediente-a' })
  assert.deepEqual(result.location.obligados.map(row => row.id), ['participant-a'])
  assert.doesNotMatch(JSON.stringify(f.responses), /FOREIGN_SENTINEL/)
})

test('F: respuesta vacia por permisos no provoca fallback con mayor acceso', async () => {
  const f = fixture({ visible: () => false })
  const result = await loadContactLocation(f.client, { expedienteId: 'expediente-a', solicitudId: 'solicitud-a' })
  assert.deepEqual(result.location.obligados, [])
  assert.equal(result.solicitud, null)
  assert.equal(f.requests.length, 3)
})

test('UI: consulta documental explicita, flag estricto y carga solo al expandir', async () => {
  const component = await readFile(new URL('../components/poliza/ContactoLocalizacion.js', import.meta.url), 'utf8')
  const modal = await readFile(new URL('../components/poliza/ModalExpediente.js', import.meta.url), 'utf8')
  assert.match(component, /data\.solicitud\?\.id && <button/)
  assert.match(component, /Consultar ficha y documentos/)
  assert.match(component, /if \(next\) load\(\)/)
  assert.doesNotMatch(component, /useEffect|storage\./)
  assert.match(component, /fetch\(`\/api\/poliza\/contacto-localizacion\?expedienteId=/)
  assert.doesNotMatch(component, /loadContactLocation\(supabase|\.from\(/)
  assert.match(modal, /NEXT_PUBLIC_BLINDAJE_CONTACTO_LOCALIZACION_ENABLED === 'true'/)
  assert.deepEqual(buildContactLocation().obligados, [])
})
