// Synthetic local portal regression; all Auth/API writes intercepted. No real data.
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROME_PATH ? { executablePath: process.env.TEST_CHROME_PATH } : {})})
const base=process.env.TEST_BASE_URL || 'http://localhost:3181',on=process.env.TEST_INVITATIONS_ENABLED!=='false'
const id='11111111-1111-4111-8111-111111111111', agency='22222222-2222-4222-8222-222222222222'
const token='a'.repeat(43)
try {for(const width of [390,1440]) {
 const context=await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']})
 await context.addInitScript(({id})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:'qa-session',refresh_token:'qa-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id}})),{id})
 const calls=[]
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url())
  if(u.pathname==='/api/partners/invitations'){calls.push({method:req.method(),...req.postDataJSON()});return route.fulfill({status:req.method()==='POST'?201:200,json:{token,ok:true}})}
  if(u.hostname==='example.supabase.co'){
   if(u.pathname.includes('partner_users'))return route.fulfill({json:{auth_user_id:id,active:true,partner_agencies:{id:agency,nombre_comercial:'QA Agencia',status:'activo'}}})
   if(u.pathname.includes('partner_operations'))return route.fulfill({json:{id,partner_agency_id:agency,nombre_inquilino:'QA Inquilino',direccion_inmueble:'QA Inmueble',status_partner:'recibida'}})
   return route.fulfill({json:[]})
  }
  if(u.pathname.startsWith('/api/'))return route.fulfill({json:{participants:[]}})
  if(u.origin!==base)return route.abort()
  return route.continue()
 })
 const p=await context.newPage();await p.goto(`${base}/partners/operaciones/${id}`)
 if(on){
 const section=p.getByRole('region',{name:'Ligas para tus clientes'});await section.waitFor()
 assert.equal(await p.getByText('Ligas personalizadas',{exact:true}).count(),0)
 assert.equal(await p.locator('a[href*="?partner="]').count(),0)
 for(const role of ['inquilino','propietario']){
 const group=section.getByRole('group',{name:role==='inquilino'?'Inquilino':'Propietario',exact:true})
 await group.getByRole('button',{name:`Generar liga para ${role}`}).click()
 const open=group.getByRole('link',{name:'Abrir',exact:true});await open.waitFor()
 const href=await open.getAttribute('href');assert.equal(new URL(href).search,'');assert.equal(new URL(href).hash,`#invite=${token}`)
 await group.getByRole('button',{name:'Copiar liga',exact:true}).click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),href)
 const popupPromise=context.waitForEvent('page');await open.click();const popup=await popupPromise;await popup.waitForLoadState();assert.equal(popup.url(),href);await popup.close()
 await section.getByLabel('Administrar ligas').selectOption(role);await section.getByRole('button',{name:'Revocar liga',exact:true}).click();await open.waitFor({state:'detached'})
 }
 assert.deepEqual(calls.map(c=>[c.method,c.role,c.operation_id]),[['POST','inquilino',id],['DELETE','inquilino',id],['POST','propietario',id],['DELETE','propietario',id]])
 } else {await p.getByText('Ligas personalizadas',{exact:true}).waitFor();assert.equal(await p.getByText('Ligas para tus clientes',{exact:true}).count(),0);assert.equal(await p.locator('a[href*="?partner="]').count(),2);assert.equal(calls.length,0)}
 if (process.env.TEST_SCREENSHOT_DIR) await p.screenshot({path:`${process.env.TEST_SCREENSHOT_DIR}/portal-${on?'on':'off'}-${width}.png`,fullPage:true});console.log('PASS portal',on?'ON':'OFF',width);await context.close()
}}finally{await browser.close()}
