// Local synthetic browser verification: no real submissions or external network.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROME_PATH ? { executablePath: process.env.TEST_CHROME_PATH } : {}) })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3181'
const enabled = process.env.TEST_INVITATIONS_ENABLED !== 'false'
const token = 'a'.repeat(43)
const id = '11111111-1111-4111-8111-111111111111'
let passed = 0
try {
  for (const width of [390, 1440]) for (const role of ['inquilino','propietario']) for (const mode of enabled ? ['valid','mixed-query','invalid','expired','revoked','wrong-role','network','link-failure'] : ['off']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    let linked, inserted, legacy = 0, validated = 0, release
    const errors = []; page.on('pageerror',e=>errors.push(e.message))
    const gate = new Promise(resolve=>{release=resolve})
    await page.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url())
      assert.ok(!url.href.includes(token),'Token must not appear in HTTP URL')
      assert.ok(!(req.headers().referer || '').includes(token),'Token in Referer')
      if(url.pathname==='/api/partners/invitation-public') {
        validated++; assert.deepEqual(req.postDataJSON(),{token}); await gate
        if(mode==='network')return route.abort()
        if(['invalid','expired','revoked'].includes(mode))return route.fulfill({status:404,json:{error:'No disponible'}})
        return route.fulfill({json:{valid:true,role:mode==='wrong-role'?(role==='inquilino'?'propietario':'inquilino'):role,
          agency:{nombre_comercial:'I2A Agencia',logo_url:null,brand_color:'#123456'},
          operation:{nombre_propietario:'I2A Propietario',nombre_inquilino:'I2A Inquilino',direccion_inmueble:'I2A Inmueble',monto_renta:15000}}})
      }
      if(url.pathname==='/api/partners/public-branding'||url.pathname==='/api/partners/link-submission') {legacy++;return route.fulfill({json:{}})}
      if(url.pathname==='/api/partners/link-submission-invited') {linked=req.postDataJSON();return route.fulfill({status:mode==='link-failure'?404:200,json:{ok:mode!=='link-failure'}})}
      if(url.hostname==='example.supabase.co') {
        if(req.method()==='POST'&&url.pathname.startsWith('/rest/v1/')){inserted=req.postDataJSON();return route.fulfill({json:{id}})}
        return route.fulfill({json:{}})
      }
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}})
      if(url.origin!==base)return route.abort()
      return route.continue()
    })
    await page.goto(`${base}/${role==='inquilino'?'solicitud-inquilino':'registro-propietario'}${mode==='mixed-query'||mode==='invalid'?'?partner=ignored&operacion=ignored':''}#invite=${token}`)
    if(!enabled) {
      await page.getByText('Antes de comenzar, cuéntanos sobre esta operación').waitFor()
      assert.equal(validated,0);assert.equal(legacy,0);passed++;await page.close();continue
    }
    await page.getByText('Validando invitación…',{exact:true}).waitFor()
    assert.equal(await page.locator('input').count(),0)
    release()
    if(['invalid','expired','revoked','wrong-role','network'].includes(mode)) {
      await page.getByRole('alert').filter({hasText:'Esta invitación ya no está disponible.'}).waitFor()
      assert.equal(await page.locator('input').count(),0);assert.equal(legacy,0);assert.equal(await page.getByText('I2A Agencia').count(),0)
    } else {
      await page.getByText(/enviad[oa] por I2A Agencia/).waitFor()
      assert.equal(await page.getByText('Antes de comenzar, cuéntanos sobre esta operación').count(),0)
      assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'),'no-referrer')
      if(role==='propietario') {
        await page.waitForFunction(()=>document.querySelector('[name=nombre_propietario]')?.value==='I2A Propietario')
        await page.locator('[name=nombre_propietario]').fill('I2A Edición manual')
      } else {
        assert.equal(await page.getByPlaceholder('Calle, número, colonia, ciudad',{exact:true}).inputValue(),'I2A Inmueble')
        assert.equal(await page.getByPlaceholder('15000',{exact:true}).inputValue(),'15000')
      }
      const total=role==='inquilino'?6:3
      for(let step=1;step<=total;step++) {
        if(role==='propietario'&&step===2) {
          await page.waitForFunction(()=>document.querySelector('[name=direccion_inmueble]')?.value==='I2A Inmueble')
          assert.equal(await page.locator('[name=monto_renta]').inputValue(),'15000')
          await page.getByRole('button',{name:/Anterior/}).click()
          await page.waitForFunction(()=>document.querySelector('[name=nombre_propietario]')?.value==='I2A Edición manual')
          await page.getByRole('button',{name:/Siguiente/}).click()
        }
        if(role==='inquilino'&&step===2) assert.equal(await page.getByPlaceholder('Como aparece en tu INE').count() ? await page.getByPlaceholder('Como aparece en tu INE').inputValue() : await page.locator('input').first().inputValue(),'I2A Inquilino')
        for(const input of await page.locator('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea').all()) {
          const type=await input.getAttribute('type')
          if(!await input.inputValue())await input.fill(type==='number'?'15000':type==='email'?'i2a@example.test':type==='tel'?'2220000000':await input.getAttribute('maxlength')==='18'?'XXXX000000XXXXXX00':'I2A Dato')
        }
        for(const input of await page.locator('input[type=file]').all())await input.setInputFiles({name:'i2a.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')})
        for(const input of await page.locator('input[type=checkbox]').all())await input.check()
        await page.getByRole('button',{name:step===total?/Enviar/:/Siguiente/}).click()
      }
      await page.getByText(role==='inquilino'?'¡Solicitud enviada!':'¡Registro enviado!',{exact:true}).waitFor()
      assert.equal(inserted.origen_operacion,'partner')
      assert.deepEqual(linked,{token,tipo:role,record_id:id});assert.equal(legacy,0)
      if(mode==='link-failure')await page.getByRole('alert').filter({hasText:'fue recibid'}).waitFor()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    }
    assert.deepEqual(errors,[])
    console.log(`PASS invitation ${role} ${mode} width=${width}`);passed++;await page.close()
  }
} finally {await browser.close()}
console.log(`${passed} invitation browser scenarios PASS`)
