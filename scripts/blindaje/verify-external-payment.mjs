// Synthetic browser tests: all DB, API and Storage requests are intercepted; no real submissions.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROME_PATH ? { executablePath: process.env.TEST_CHROME_PATH } : {}) })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3181'
const enabled = process.env.TEST_EXTERNAL_PAYMENT_ENABLED !== 'false'
const token = 'a'.repeat(43), payToken = 'b'.repeat(43), claimHash = 'c'.repeat(64), id = '11111111-1111-4111-8111-111111111111'
let passed = 0
try {
  for (const width of [390,1440]) for (const role of ['inquilino','propietario']) for (const mode of (enabled ? ['emporio','b2c','secure','legacy','lost-insert','bootstrap-failure','link-failure'] : ['emporio','b2c','secure','legacy'])) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    const calls = { claim:0, bootstrap:0, analyze:0, insert:0, link:0 }; let payload
    const secure = ['secure','link-failure'].includes(mode), b2c = ['b2c','lost-insert','bootstrap-failure'].includes(mode)
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      assert.ok(!url.href.includes(token) && !url.href.includes(payToken)); assert.ok(!(req.headers().referer || '').includes(token))
      if (url.pathname === '/api/blindaje/b2c-submission-token') { calls.claim++; assert.deepEqual(req.postDataJSON(),{role}); return route.fulfill({json:{token,claim_hash:claimHash,expires_at:'2099-01-01'}}) }
      if (url.pathname.includes('/external-payment/bootstrap-')) {
        calls.bootstrap++; assert.deepEqual(req.postDataJSON(), secure ? {invitation_token:token} : {token,role})
        return route.fulfill({status: mode === 'bootstrap-failure' ? 503 : 200, json: mode === 'bootstrap-failure' ? {error:'No disponible'} : {folio:'BL-2026-000001',payment_token:payToken}})
      }
      if (url.pathname === '/api/analizar-solicitud') { calls.analyze++; return route.fulfill({json:{}}) }
      if (url.pathname === '/api/partners/invitation-public' || url.pathname === '/api/partners/public-branding') return route.fulfill({json:{valid:true,role,
        agency:{id:'agency',status:'activo',nombre_comercial:'I2A-QA Agencia',logo_url:null,brand_color:'#b91c3c'},
        operation:{id:'operation',nombre_propietario:'I2A-QA Propietario',nombre_inquilino:'I2A-QA Inquilino',direccion_inmueble:'I2A-QA Dirección',monto_renta:15000}}})
      if (url.pathname === '/api/partners/link-submission-invited' || url.pathname === '/api/partners/link-submission') {
        calls.link++; return route.fulfill({status:mode==='link-failure'?404:200,json:{ok:mode!=='link-failure'}})
      }
      if (url.hostname === 'example.supabase.co') {
        if (req.method() === 'POST' && url.pathname.startsWith('/rest/v1/')) {
          calls.insert++; payload = req.postDataJSON()
          if (enabled && mode === 'lost-insert') return route.abort()
          return route.fulfill({json:{id}})
        }
        return route.fulfill({json:{}})
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}})
      if (url.origin !== base) return route.abort()
      return route.continue()
    })
    await page.goto(`${base}/${role==='inquilino'?'solicitud-inquilino':'registro-propietario'}${secure?`#invite=${token}`:mode==='legacy'?'?partner=agency&operacion=operation&participante=participant':''}`)
    if (!secure && mode !== 'legacy') {
      await page.locator(`input[value="${b2c?'b2c':'emporio'}"]`).check()
      if (!b2c) await page.locator('#asesor-referencia').fill('I2A-QA Asesor')
      await page.getByRole('button',{name:'Continuar',exact:true}).click()
    } else await page.getByText(/enviad[oa] por I2A-QA Agencia/).waitFor()
    const total = role === 'inquilino' ? 6 : 3
    for (let step=1;step<=total;step++) {
      for (const input of await page.locator('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea').all()) {
        const type = await input.getAttribute('type')
        if (!await input.inputValue()) await input.fill(type==='number'?'15000':type==='email'?'i2a-qa@example.test':type==='tel'?'2220000000':await input.getAttribute('maxlength')==='18'?'XXXX000000XXXXXX00':'I2A-QA Dato')
      }
      for (const input of await page.locator('input[type=file]').all()) await input.setInputFiles({name:'I2A-QA.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')})
      for (const input of await page.locator('input[type=checkbox]').all()) await input.check()
      const next = page.getByRole('button',{name:step===total?/Enviar/:/Siguiente/})
      if (step === total && enabled) await next.evaluate(button => { button.click(); button.click() })
      else await next.click()
    }
    const external = enabled && mode !== 'emporio'
    await page.getByRole('heading',{name:external?'Información recibida':role==='inquilino'?'¡Solicitud enviada!':'¡Registro enviado!',exact:true}).waitFor()
    assert.equal(calls.insert,1,'double click must not duplicate form')
    assert.equal(calls.analyze, role==='inquilino' && !external ? 1 : 0,'external analysis must never run')
    assert.equal(calls.claim, enabled && b2c ? 1 : 0)
    assert.equal(calls.bootstrap, enabled && (b2c || mode==='secure') ? 1 : 0)
    assert.equal(payload.blindaje_submission_claim_hash, enabled && b2c ? claimHash : undefined)
    assert.equal(payload.origen_operacion, b2c?'b2c':mode==='emporio'?'emporio':'partner')
    if (external && ['bootstrap-failure','link-failure'].includes(mode)) await page.getByText(/Tu solicitud fue recibida correctamente/).waitFor()
    if (external && mode==='legacy') { await page.getByText(/solicita a tu inmobiliaria una liga actualizada/).waitFor(); assert.equal(await page.locator('a[href*="#pay="]').count(),0) }
    if (external && (mode==='secure' || mode==='b2c' || mode==='lost-insert')) assert.equal(await page.getByRole('link',{name:'Ver instrucciones del anticipo'}).getAttribute('href'),`/blindaje/anticipo#pay=${payToken}`)
    assert.deepEqual(errors,[])
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    console.log(`PASS ${mode} ${role} ${width} flag=${enabled}`);passed++;await page.close()
  }
  for (const width of [390,1440]) {
    const page = await browser.newPage({viewport:{width,height:844}})
    let proof = 0, publicCalls = 0
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url())
      assert.ok(!url.href.includes(payToken))
      if (url.pathname.endsWith('/payment-public')) { publicCalls++; assert.deepEqual(req.postDataJSON(),{token:payToken}); return route.fulfill({json:{folio:'BL-2026-000001',amount:1000,currency:'MXN',status:'pending',bank:{banco:'I2A-QA Banco',titular:'I2A-QA Titular',clabe:'000000000000000000'}}}) }
      if (url.pathname.endsWith('/blindaje-payment-proof')) {
        proof++; assert.equal(url.hostname,'example.supabase.co'); assert.equal(req.headers().authorization,`Bearer ${payToken}`)
        assert.equal(req.headers()['x-payer-role'],'tercero'); assert.equal(req.postDataBuffer().subarray(0,5).toString(),'%PDF-')
        return route.fulfill({headers:{'access-control-allow-origin':'*'},json:{status:'proof_received'}})
      }
      if (url.origin!==base)return route.abort()
      return route.continue()
    })
    await page.goto(`${base}/blindaje/anticipo#pay=${payToken}`)
    if (!enabled) { await page.getByText('Esta página no está disponible.').waitFor();assert.equal(publicCalls,0) }
    else {
      await page.getByText('I2A-QA Banco',{exact:true}).waitFor()
      await page.getByLabel('¿Quién realiza el pago?').selectOption('tercero')
      await page.getByLabel('Nombre del pagador').fill('I2A-QA Tercero')
      await page.locator('#proof').setInputFiles({name:'I2A-QA.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')})
      await page.getByRole('button',{name:'Enviar comprobante',exact:true}).click()
      await page.getByText('Pendiente de validación por Emporio',{exact:true}).waitFor()
      await page.getByRole('button',{name:'Reemplazar comprobante'}).click()
      await page.waitForFunction(()=>document.querySelector('button[type=submit]')?.textContent==='Reemplazar comprobante')
      assert.equal(proof,2)
      await page.evaluate(()=>{window.__copied='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copied=value}},configurable:true})})
      await page.getByRole('button',{name:'Copiar liga de pago'}).click()
      assert.equal(await page.evaluate(()=>window.__copied),`${base}/blindaje/anticipo#pay=${payToken}`)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      if(process.env.TEST_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.TEST_SCREENSHOT_DIR}/anticipo-${width}.png`,fullPage:true})
    }
    console.log(`PASS payment page ${width} flag=${enabled}`);passed++;await page.close()
  }
} finally { await browser.close() }
console.log(`${passed} external payment browser scenarios PASS`)
