// Read-only real Preview visual check. Cookies/tokens are private files outside the repository.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const root=process.argv[2], base=process.argv[3]
assert.match(base,/^https:\/\/inmoadmin-[a-z0-9-]+\.vercel\.app$/)
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROME_PATH?{executablePath:process.env.TEST_CHROME_PATH}:{})})
const issued=JSON.parse(fs.readFileSync(`${root}/issued.json`,'utf8'))
try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}})
    const cookies=JSON.parse(fs.readFileSync(`${root}/browser-cookies.json`,'utf8'))
    await context.addCookies(cookies)
    const page=await context.newPage(),errors=[],hosts=new Set()
    page.on('pageerror',e=>errors.push(e.message))
    page.on('request',req=>{const url=new URL(req.url());hosts.add(url.hostname);assert.ok(!url.search.includes('pay='));assert.ok(!req.url().includes(issued.partner.inquilino.payment_token))})
    await page.goto(`${base}/blindaje/anticipo#pay=${issued.partner.inquilino.payment_token}`)
    await page.getByText('Pendiente de validación por Emporio',{exact:true}).waitFor()
    await page.getByText('I2A-QA Banco sintético',{exact:true}).waitFor()
    assert.equal(await page.getByText(issued.partner.inquilino.folio,{exact:true}).count(),2)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    assert.deepEqual(errors,[])
    assert.ok(!hosts.has('bnzrnizrmonjxlktbhlp.supabase.co'),'Production must never be contacted')
    await page.screenshot({path:`${root}/preview-${width}.png`,fullPage:true})
    console.log(`PASS real Preview read-only ${width}, pending validation, synthetic bank, no production host`)
    await context.close()
  }
} finally {await browser.close()}
