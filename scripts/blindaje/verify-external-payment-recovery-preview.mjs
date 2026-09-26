// Existing synthetic DEV fixtures only. No form INSERTs allowed; secrets never printed.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const root=process.argv[2], base=process.argv[3]
assert.match(base,/^https:\/\/inmoadmin-[a-z0-9-]+\.vercel\.app$/)
const issued=JSON.parse(fs.readFileSync(`${root}/issued.json`,'utf8'))
const fixtures=JSON.parse(fs.readFileSync(`${root}/fixtures.json`,'utf8'))
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROME_PATH?{executablePath:process.env.TEST_CHROME_PATH}:{})})
try {
 for(const width of [390,1440]) for(const role of ['inquilino','propietario']) for(const origin of ['b2c','partner']) {
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.addCookies(JSON.parse(fs.readFileSync(`${root}/browser-cookies.json`,'utf8')))
  const page=await context.newPage(),errors=[];let bootstraps=0, forbidden=0
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.hostname==='bnzrnizrmonjxlktbhlp.supabase.co'||url.pathname==='/api/analizar-solicitud'||request.method()==='POST'&&url.pathname.startsWith('/rest/v1/')||url.pathname==='/api/blindaje/b2c-submission-token') {
    forbidden++;return route.abort()
   }
   assert.ok(!url.search.includes('pay='));assert.ok(!url.search.includes('invite='))
   if(url.pathname.includes('/external-payment/bootstrap-'))bootstraps++
   await route.continue()
  })
  const form=`${base}/${role==='inquilino'?'solicitud-inquilino':'registro-propietario'}${origin==='partner'?`#invite=${fixtures.roles[role].invitation_token}`:''}`
  const expected=origin==='b2c'?issued.b2c[role].payment.folio:issued.partner[role].folio
  if(origin==='b2c') {
   assert.ok(Date.parse(issued.b2c[role].claim.expires_at)>Date.now(),'Existing DEV claim expired; do not silently replace fixture')
   await page.goto(base+'/blindaje/anticipo')
   await page.evaluate(({claim,role})=>sessionStorage.setItem(`blindaje:b2c:submission:${role}`,JSON.stringify({token:claim.token,claim_hash:claim.claim_hash,expires_at:claim.expires_at,role})),{claim:issued.b2c[role].claim,role})
  }
  for(let attempt=0;attempt<2;attempt++) {
   await page.goto(form)
   // Reload the form with the original credential; recovery must happen before a submit.
   if(attempt===0)await page.reload()
   if(origin==='b2c') {
    await page.locator('input[value="b2c"]').check()
    await page.getByRole('button',{name:'Continuar',exact:true}).click()
   }
   await page.getByText('I2A-QA Banco sintético',{exact:true}).waitFor()
   assert.equal(await page.getByText(expected,{exact:true}).count(),2)
   assert.equal(new URL(page.url()).pathname,'/blindaje/anticipo');assert.match(new URL(page.url()).hash,/^#pay=[A-Za-z0-9_-]{43}$/)
   const paymentURL=page.url()
   await page.reload();await page.getByText('I2A-QA Banco sintético',{exact:true}).waitFor()
   assert.equal(page.url(),paymentURL)
  }
  assert.ok(bootstraps>=2);assert.equal(forbidden,0);assert.deepEqual(errors,[])
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`${root}/recovery-${origin}-${role}-${width}.png`,fullPage:true})
  console.log(`PASS real DEV recovery ${origin} ${role} ${width}: same folio, no form INSERT, no new claim, no analysis, payment refresh`)
  await context.close()
 }
}finally{await browser.close()}
