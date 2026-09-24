import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hasPartnerContext, needsOrigenStep, origenMetadata } from '../lib/blindajeOrigen.mjs'

test('generic links require classification only after router hydration', () => {
  assert.equal(needsOrigenStep(true, false, {}, null), false)
  assert.equal(needsOrigenStep(true, true, {}, null), true)
  assert.equal(needsOrigenStep(true, true, {}, { origen_operacion: 'b2c' }), false)
  assert.throws(() => origenMetadata(true, {}, null))
})
test('Emporio stores a trimmed informational reference; no recuerdo remains null', () => {
  assert.deepEqual(origenMetadata(true, {}, { origen_operacion: 'emporio', asesor_referencia: ' Ana ' }), { origen_operacion: 'emporio', asesor_referencia: 'Ana' })
  assert.deepEqual(origenMetadata(true, {}, { origen_operacion: 'emporio', asesor_referencia: null }), { origen_operacion: 'emporio', asesor_referencia: null })
})
test('B2C never carries advisor data', () => {
  assert.deepEqual(origenMetadata(true, {}, { origen_operacion: 'b2c', asesor_referencia: 'stale' }), { origen_operacion: 'b2c', asesor_referencia: null })
})
test('Partner bypasses the gate and takes priority over a stale generic selection', () => {
  const query = { partner: 'agency', operacion: 'operation', participante: 'participant' }
  assert.equal(hasPartnerContext(query), true)
  assert.equal(needsOrigenStep(true, true, query, null), false)
  assert.deepEqual(origenMetadata(true, query, { origen_operacion: 'b2c' }), { origen_operacion: 'partner', asesor_referencia: null })
  assert.equal(hasPartnerContext({ partner: 'agency' }), false)
})
test('flag OFF omits metadata for both generic and Partner links', () => {
  for (const query of [{}, { partner: 'a', operacion: 'b' }]) {
    assert.equal(needsOrigenStep(false, true, query, null), false)
    assert.deepEqual(origenMetadata(false, query, null), {})
  }
})
test('internal flow and Partner endpoint are byte-identical to the reviewed base', () => {
  for (const file of ['components/poliza/ModalSolicitud.js', 'pages/poliza/index.js', 'pages/api/partners/link-submission.js']) {
    assert.equal(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), execFileSync('git', ['show', '2c84d4f4379202bc3f504e2cf91777873621ab87:' + file], { encoding: 'utf8' }))
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
})
