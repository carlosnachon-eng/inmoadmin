// Run against a local build with dummy Supabase configuration only.
// PLAYWRIGHT_MODULE may point to an installed playwright module.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROME_PATH ? { executablePath: process.env.TEST_CHROME_PATH } : {}) })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3181'
const enabled = process.env.TEST_ORIGEN_ENABLED !== 'false'
const question = 'Antes de comenzar, cuéntanos sobre esta operación'
const syntheticId = '11111111-1111-4111-8111-111111111111'
let passed = 0
try {
  for (const tipo of ['inquilino', 'propietario']) {
    for (const mode of enabled ? ['emporio', 'no-recuerdo', 'b2c', 'partner', 'invalid-emporio', 'invalid-b2c', 'network-b2c', 'malformed-b2c', 'only-partner', 'only-operation'] : ['generic', 'partner', 'invalid-b2c', 'only-partner', 'only-operation']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      let payload, linked, releaseBranding
      const candidate = ['partner', 'invalid-emporio', 'invalid-b2c', 'network-b2c', 'malformed-b2c'].includes(mode)
      const choice = mode === 'invalid-emporio' ? 'emporio' : ['invalid-b2c', 'network-b2c', 'malformed-b2c', 'only-partner', 'only-operation'].includes(mode) ? 'b2c' : mode
      const brandingReady = new Promise(resolve => { releaseBranding = resolve })
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.pathname === '/api/partners/public-branding') {
          if (enabled) await brandingReady
          if (mode === 'network-b2c') return route.abort()
          if (mode === 'invalid-emporio' || mode === 'invalid-b2c') return route.fulfill({ status: mode === 'invalid-emporio' ? 404 : 500, json: { error: 'Operación no disponible' } })
          if (mode === 'malformed-b2c') return route.fulfill({ json: { agency: { id: 'agency' } } })
          return route.fulfill({ json: {
            agency: { id: 'agency', status: 'activo', nombre_comercial: 'Partner sintético', brand_color: '#123456' },
            operation: { id: 'operation', direccion_inmueble: 'Inmueble sintético Partner', monto_renta: 15000 },
          } })
        }
        if (url.pathname === '/api/partners/link-submission') {
          linked = request.postDataJSON()
          return route.fulfill({ json: { ok: true } })
        }
        if (url.hostname === 'example.supabase.co') {
          if (request.method() === 'POST' && url.pathname.startsWith('/rest/v1/')) {
            payload = request.postDataJSON()
            return route.fulfill({ json: { id: syntheticId } })
          }
          return route.fulfill({ json: {} })
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
        if (url.origin !== base) return route.abort()
        return route.continue()
      })
      const suffix = candidate ? '?partner=agency&operacion=operation&participante=participant' : mode === 'only-partner' ? '?partner=agency' : mode === 'only-operation' ? '?operacion=operation' : ''
      await page.goto(`${base}/${tipo === 'inquilino' ? 'solicitud-inquilino' : 'registro-propietario'}${suffix}`)
      if (enabled && candidate) {
        await page.getByText('Validando operación Partner…', { exact: true }).waitFor()
        assert.equal(await page.getByText(question).count(), 0)
        assert.equal(await page.getByRole('button', { name: /Siguiente/ }).count(), 0)
        releaseBranding()
      }
      if (enabled && mode !== 'partner') {
        await page.getByText(question).waitFor()
        assert.equal(await page.getByRole('button', { name: 'Continuar', exact: true }).isDisabled(), true)
        await page.locator(`input[value="${choice === 'b2c' ? 'b2c' : 'emporio'}"]`).check()
        if (choice === 'b2c') assert.equal(await page.locator('#asesor-referencia').count(), 0)
        else {
          await page.locator('#asesor-referencia').waitFor()
          if (mode === 'no-recuerdo') await page.getByLabel('No recuerdo').check()
          else await page.locator('#asesor-referencia').fill(' Asesor sintético ')
        }
        await page.getByRole('button', { name: 'Continuar', exact: true }).click()
      }
      await page.getByText(tipo === 'inquilino' ? 'Datos del Inmueble' : 'Datos del dueño', { exact: true }).last().waitFor()
      assert.equal(await page.getByText(question).count(), 0)
      if (mode === 'partner') {
        await page.getByText(/enviad[oa] por Partner sintético/).waitFor()
        if (tipo === 'inquilino') {
          assert.equal(await page.getByPlaceholder('Calle, número, colonia, ciudad', { exact: true }).inputValue(), 'Inmueble sintético Partner')
          assert.equal(await page.getByPlaceholder('15000', { exact: true }).inputValue(), '15000')
        }
      }
      const total = tipo === 'inquilino' ? 6 : 3
      for (let step = 1; step <= total; step++) {
        if (tipo === 'propietario' && step === 2) {
          const text = await page.locator('body').innerText()
          assert.equal(text.includes('promocionaremos'), !(enabled && choice === 'b2c'))
          if (enabled && choice === 'b2c') assert.ok(text.includes('integrar el expediente'))
          if (mode === 'partner') {
            await page.waitForFunction(() => document.querySelector('[name="direccion_inmueble"]')?.value === 'Inmueble sintético Partner')
            assert.equal(await page.locator('[name="direccion_inmueble"]').inputValue(), 'Inmueble sintético Partner')
            assert.equal(await page.locator('[name="monto_renta"]').inputValue(), '15000')
          }
        }
        for (const input of await page.locator('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea').all()) {
          const type = await input.getAttribute('type')
          const value = type === 'number' ? '15000' : type === 'email' ? 'synthetic@example.test' : type === 'tel' ? '2220000000' : (await input.getAttribute('maxlength')) === '18' ? 'XXXX000000XXXXXX00' : 'Dato sintético'
          if (!await input.inputValue()) await input.fill(value)
        }
        for (const input of await page.locator('input[type=file]').all()) await input.setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic') })
        for (const input of await page.locator('input[type=checkbox]').all()) await input.check()
        assert.equal((await page.locator('body').innerText()).includes('$1,000'), false)
        await page.getByRole('button', { name: step === total ? /Enviar/ : /Siguiente/ }).click()
      }
      await page.getByText(tipo === 'inquilino' ? '¡Solicitud enviada!' : '¡Registro enviado!', { exact: true }).waitFor()
      const expected = mode === 'no-recuerdo' ? 'emporio' : choice
      assert.equal(payload.origen_operacion, enabled ? expected : undefined)
      assert.equal(payload.asesor_referencia, enabled ? choice === 'emporio' ? 'Asesor sintético' : null : undefined)
      if (mode === 'partner' || (!enabled && candidate)) {
        assert.deepEqual(linked, { partner_agency_id: 'agency', partner_operation_id: 'operation', participant_id: 'participant', tipo, record_id: syntheticId })
      } else assert.equal(linked, undefined)
      if (enabled && choice === 'b2c' && tipo === 'propietario') assert.equal((await page.locator('body').innerText()).includes('promoción'), false)
      assert.deepEqual(errors, [])
      console.log(`PASS ${tipo} ${mode} flag=${enabled}`)
      passed++
      await page.close()
    }
  }
} finally {
  await browser.close()
}
console.log(`${passed} browser submission scenarios PASS`)
