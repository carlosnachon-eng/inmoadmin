import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hasPartnerCandidate, partnerCandidateKey, validatedPartnerResponse, partnerContextStatus, needsOrigenStep, origenMetadata, shouldLinkPartner } from '../lib/blindajeOrigen.mjs'

const query = { partner: 'agency', operacion: 'operation', participante: 'participant' }
const response = { agency: { id: 'agency', status: 'activo' }, operation: { id: 'operation' } }
const validation = status => ({ key: partnerCandidateKey(query), status })

test('candidate waits for validation without showing Paso 0 or allowing metadata/linking', () => {
  assert.equal(hasPartnerCandidate(query), true)
  assert.equal(partnerContextStatus(query, null), 'pending')
  assert.equal(needsOrigenStep(true, true, 'pending', null), false)
  assert.equal(shouldLinkPartner(true, query, 'pending'), false)
  assert.throws(() => origenMetadata(true, 'pending', { origen_operacion: 'b2c' }))
})
test('only a successful matching public-branding response validates Partner', () => {
  assert.equal(validatedPartnerResponse(query, response), true)
  for (const data of [null, {}, { agency: response.agency }, { ...response, operation: { id: 'other' } }, { ...response, agency: { id: 'other', status: 'activo' } }, { ...response, agency: { id: 'agency', status: 'inactivo' } }]) assert.equal(validatedPartnerResponse(query, data), false)
  assert.equal(partnerContextStatus(query, validation('valid')), 'valid')
  assert.equal(needsOrigenStep(true, true, 'valid', null), false)
  assert.deepEqual(origenMetadata(true, 'valid', null), { origen_operacion: 'partner', asesor_referencia: null })
  assert.equal(shouldLinkPartner(true, query, 'valid'), true)
})
test('invalid and failed validation require an explicit generic choice and never link', () => {
  const status = partnerContextStatus(query, validation('invalid'))
  assert.equal(status, 'invalid')
  assert.equal(needsOrigenStep(true, true, status, null), true)
  assert.throws(() => origenMetadata(true, status, null))
  assert.equal(shouldLinkPartner(true, query, status), false)
  for (const origen of ['emporio', 'b2c']) {
    assert.equal(needsOrigenStep(true, true, status, { origen_operacion: origen }), false)
    assert.deepEqual(origenMetadata(true, status, { origen_operacion: origen }), { origen_operacion: origen, asesor_referencia: null })
  }
})
test('missing or partial candidate is generic; router must be ready', () => {
  for (const q of [{}, { partner: 'agency' }, { operacion: 'operation' }]) {
    assert.equal(partnerContextStatus(q, null), 'none')
    assert.equal(needsOrigenStep(true, false, 'none', null), false)
    assert.equal(needsOrigenStep(true, true, 'none', null), true)
    assert.equal(shouldLinkPartner(true, q, 'none'), false)
  }
})
test('validation cannot be reused for a different operation or agency', () => {
  assert.equal(partnerContextStatus({ ...query, operacion: 'other' }, validation('valid')), 'pending')
  assert.equal(partnerContextStatus({ ...query, partner: 'other' }, validation('valid')), 'pending')
})
test('Emporio reference and no recuerdo; B2C discards stale reference', () => {
  assert.deepEqual(origenMetadata(true, 'none', { origen_operacion: 'emporio', asesor_referencia: ' Ana ' }), { origen_operacion: 'emporio', asesor_referencia: 'Ana' })
  assert.deepEqual(origenMetadata(true, 'invalid', { origen_operacion: 'emporio', asesor_referencia: null }), { origen_operacion: 'emporio', asesor_referencia: null })
  assert.deepEqual(origenMetadata(true, 'invalid', { origen_operacion: 'b2c', asesor_referencia: 'stale' }), { origen_operacion: 'b2c', asesor_referencia: null })
})
test('flag OFF preserves main linking rule, omits metadata and never gates on validation', () => {
  for (const status of ['none', 'pending', 'valid', 'invalid']) {
    assert.equal(needsOrigenStep(false, true, status, null), false)
    assert.deepEqual(origenMetadata(false, status, null), {})
    assert.equal(shouldLinkPartner(false, query, status), true)
    assert.equal(shouldLinkPartner(false, { partner: 'agency' }, status), false)
  }
})
test('legacy Partner endpoints are byte-identical to the reviewed base', () => {
  for (const file of ['pages/api/partners/link-submission.js', 'pages/api/partners/public-branding.js']) {
    assert.equal(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), execFileSync('git', ['show', '9876bae968c4af5bb83ab5b9e1debbd5750bc75b:' + file], { encoding: 'utf8' }))
  }
})

test('historical NULL origin renders identically in Jurídico and preserves investigation controls', async () => {
  const require = createRequire(import.meta.url)
  const { transform } = require('next/dist/build/swc')
  const compile = async (file, dependencies = {}) => {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    const { code } = await transform(source, { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', 'React', code)(id => dependencies[id] || require(id), module, module.exports, React)
    return module.exports
  }
  const utils = await compile('lib/polizaUtils.js')
  const { default: Modal } = await compile('components/poliza/ModalSolicitud.js', { '../../lib/polizaUtils': utils, '../../lib/supabase': { supabase: {} } })
  const historical = { id: 'synthetic', nombre_completo: 'Histórico sintético', status: 'rechazado' }
  const render = solicitud => renderToStaticMarkup(React.createElement(Modal, { solicitud }))
  assert.equal(render(historical), render({ ...historical, origen_operacion: null, asesor_referencia: null }))
  assert.ok(render(historical).includes('Registrar cobro $1,000'))
  assert.equal(render(historical), render({ ...historical, origen_operacion: 'emporio' }))
  for (const origen_operacion of ['b2c', 'partner']) {
    const html = render({ ...historical, origen_operacion })
    assert.ok(!html.includes('Registrar cobro $1,000'))
    assert.ok(html.includes('se gestiona desde Anticipos externos'))
  }
})
