// Actual JSX page, isolated React render with simulated APIs/session. No real backend.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import http from 'node:http';
const deps=process.env.META_INBOX_UI_DEPS, browserDeps=process.env.META_INBOX_BROWSER_DEPS;
assert.ok(path.isAbsolute(deps||'')&&path.isAbsolute(browserDeps||''));
const require=createRequire(path.join(deps,'package.json')),requireBrowser=createRequire(path.join(browserDeps,'package.json'));
const {build}=require('esbuild'),{chromium}=requireBrowser('playwright');
const pageFile=fileURLToPath(new URL('../pages/administracion/inbox.js',import.meta.url));
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Page from ${JSON.stringify(pageFile)};createRoot(document.getElementById('root')).render(<Page/>);`,loader:'jsx',resolveDir:path.dirname(pageFile)},bundle:true,write:false,jsx:'automatic',nodePaths:[deps],loader:{'.js':'jsx'},plugins:[{
 name:'fixture-boundaries',setup(b){b.onResolve({filter:/^(next\/head|\.\.\/\.\.\/components\/Layout|\.\.\/\.\.\/lib\/supabase)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.includes('supabase')?`export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only'}}})}};`:a.path.includes('head')?`export default ()=>null;`:`export default ({children})=>children;`,loader:'js'}));}
}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><head><meta charset="utf-8"/></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;let posts=0,paused=false,outcome='accepted',messages=[];
const input='10000000-0000-4000-8000-000000000001',stamp='2026-10-09T15:00:00Z';
try{
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1280,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/operaciones/meta-admin-inbox*',async route=>{
  const request=route.request();let result;
  if(request.url().includes('inbox-manual')){
   if(request.method()==='POST'){
    posts++;const body=request.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['action_id','input_id','text']);assert.equal(body.input_id,input);
    paused=true;messages=[{action_id:body.action_id,created_at:stamp,text:body.text,status:outcome}];
    result={status:outcome,paused:true};
   }else result={data:{paused,messages},enabled:true};
  }else if(request.url().includes('?input_id='))result={data:{input_id:input,identity_state:'unmatched',ai:{state:'blocked'},context:{state:'blocked'},episodes:[],messages:[{message_ref:input,occurred_at:stamp,provenance:'customer_inbound',text:'Hola, necesito orientación.'}]}};
  else result={data:[{input_id:input,last_activity:stamp,identity_state:'unmatched',label:'Contacto sin identificar'}]};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Cargar / actualizar conversaciones'}).click();
 await page.getByRole('button',{name:/Contacto sin identificar/}).click();
 await page.getByLabel('Respuesta manual por Meta').fill('Recibimos tu mensaje.');
 await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Enviar por Meta');button.click();button.click();});
 await page.getByRole('button',{name:/Redactar otro mensaje/}).waitFor();assert.equal(posts,1);
 await page.getByText(/IA pausada por atención humana/).waitFor();
 assert.equal(await page.getByLabel('Respuesta manual por Meta').isDisabled(),true);
 await page.getByRole('button',{name:'Consultar estado (sin reenviar)'}).click();assert.equal(posts,1);
 outcome='uncertain';await page.getByRole('button',{name:/Redactar otro mensaje/}).click();
 await page.getByLabel('Respuesta manual por Meta').fill('Otra respuesta de fixture.');await page.getByRole('button',{name:'Enviar por Meta',exact:true}).click();
 await page.getByText('uncertain',{exact:true}).waitFor();assert.equal(posts,2);
 assert.equal(await page.getByRole('button',{name:/Redactar otro mensaje/}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Enviar por Meta',exact:true}).isDisabled(),true);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(path.dirname(deps),'inbox-manual.png'),fullPage:true});
 console.log('PASS UI: actual JSX, unmatched no private context, double click 1 POST, pause visible, status read no resend, uncertain locks composer. Real sends=0.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
