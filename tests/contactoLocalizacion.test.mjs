import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildContactLocation, buildReferences } from '../lib/poliza/contactoLocalizacion.js'

test('conserva las seis referencias existentes sin reducirlas', () => {
  const solicitud = {}
  for (let index = 1; index <= 3; index += 1) {
    solicitud[`ref_fam${index}_nombre`] = `Familiar ${index}`
    solicitud[`ref_fam${index}_telefono`] = `220000000${index}`
    solicitud[`ref_per${index}_nombre`] = `Personal ${index}`
    solicitud[`ref_per${index}_telefono`] = `221000000${index}`
  }
  assert.equal(buildReferences(solicitud).length, 6)
})

test('distingue domicilio declarado y conserva fuentes estructuradas', () => {
  const result = buildContactLocation({
    id: 'solicitud-1',
    telefono: '2200000000',
    domicilio_actual: 'Domicilio declarado',
    empresa_labora: 'Empresa sintética',
    nombre_arrendador_actual: 'Arrendador sintético',
  }, [{
    id: 'participante-1',
    nombre: 'Obligado sintético',
    data_json: { domicilio: 'Domicilio obligado', relacion_inquilino: 'Familiar' },
    docs_json: [{ key: 'identificacion' }],
  }])

  assert.equal(result.principal.domicilioDeclarado, 'Domicilio declarado')
  assert.equal(result.arrendadorAnterior.nombre, 'Arrendador sintético')
  assert.equal(result.obligados[0].fuente, 'Participante vinculado por operación Partner')
  assert.equal(result.obligados[0].tieneDocumentos, true)
})

test('no inventa contactos cuando la solicitud no contiene datos', () => {
  const result = buildContactLocation({}, [])
  assert.deepEqual(result.referencias, [])
  assert.deepEqual(result.obligados, [])
})

test('el panel carga por ID, conserva RLS y no solicita documentos Base64', async () => {
  const source = await readFile(new URL('../components/poliza/ContactoLocalizacion.js', import.meta.url), 'utf8')
  assert.match(source, /\.eq\('id', solicitudId\)/)
  assert.match(source, /solicitud_inquilino_id\.eq\.\$\{solicitudId\}/)
  assert.match(source, /poliza_expediente_id\.eq\.\$\{expedienteId\}/)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(source, /doc_identificacion_b64|doc_comprobante_ingresos_b64/)
})
