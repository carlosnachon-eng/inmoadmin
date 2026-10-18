// Real JSX, isolated synthetic session/APIs. Network denied except this local fixture.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import http from 'node:http';
const require=createRequire(import.meta.url),deps=createRequire(path.join(process.env.FB_UI_DEPS,'package.json'));
const {build}=deps('esbuild'),{chromium}=createRequire(path.join(process.env.FB_BROWSER_DEPS,'package.json'))('playwright');
const source=path.resolve('components/CommercialInbox.js');
const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Inbox from ${JSON.stringify(source)};createRoot(document.getElementById('root')).render(<Inbox instagramAvailable/>);`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},plugins:[{name:'session',setup(b){
 b.onResolve({filter:/lib\/supabase$/},()=>({path:'session',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-local-only'}}})}};`,loader:'js'}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>${built.outputFiles[0].text}</script></body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,posts=0,consumed=false,enabled=false;
const thread='a'.repeat(64),input='b'.repeat(64);
try{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  let body={rows:[]};
  if(url.pathname.endsWith('facebook-messenger')){
   assert.equal(route.request().method(),'POST');posts++;consumed=true;body={status:'accepted'};
  }else if(url.pathname.endsWith('facebook-messenger-inbox')){
   body={sender_enabled:enabled,rows:url.searchParams.get('op')==='history'?[{input,kind:'inbound',text:'Fixture Facebook',occurred_at:'2026-10-18T18:00:00Z',can_reply:!consumed,outcome:consumed?'accepted':null}]:[{thread_ref:thread,occurred_at:'2026-10-18T18:00:00Z'}]};
  }else if(url.searchParams.get('op')==='threads')body={rows:[{thread_ref:thread,profile_name:'Fixture Instagram'}]};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Facebook Conversación 1',exact:true}).waitFor();
 assert.equal(await page.locator('aside[aria-label="Conversaciones"] button').count(),2);
 await page.getByRole('button',{name:'Facebook',exact:true}).click();
 assert.equal(await page.locator('aside[aria-label="Conversaciones"] button').count(),1);
 await page.getByRole('button',{name:'Facebook Conversación 1',exact:true}).click();
 await page.getByText('Fixture Facebook',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Enviar una vez'}).isDisabled(),true);assert.equal(posts,0);
 enabled=true;await page.getByRole('button',{name:'Actualizar historial'}).click();
 await page.getByText('Sender habilitado · Atención manual · Sin IA').waitFor();
 await page.getByRole('button',{name:'Responder a este mensaje'}).click();
 await page.getByLabel('Respuesta manual Facebook').fill('Respuesta sintética');
 await page.getByRole('button',{name:'Enviar una vez'}).dblclick();
 await page.getByText('Aceptado por Meta. La recepción se confirma por echo.').waitFor();
 assert.equal(posts,1);await page.getByRole('button',{name:'Actualizar historial'}).click();assert.equal(posts,1);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('aside[aria-label="Conversaciones"]').isVisible(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'← Conversaciones',exact:true}).click();
 assert.equal(await page.locator('aside[aria-label="Conversaciones"]').isVisible(),true);
 await page.getByRole('button',{name:'Todos',exact:true}).click();assert.equal(await page.locator('aside[aria-label="Conversaciones"] button').count(),2);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ui:'PASS',desktop:true,mobile_width:390,duplicate_click_posts:posts,refresh_posts:0,real_sends:0}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
