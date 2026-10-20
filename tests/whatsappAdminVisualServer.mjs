// Optional manual browser harness. Real components + reader/adapter, memory-only fixtures.
import http from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {syntheticQA} from './whatsappAdminSynthetic.mjs';
const deps=createRequire(path.join(process.env.WA_QA_DEPS,'package.json'));
const qa=syntheticQA();
const {build}=deps('esbuild');
const local=createRequire(import.meta.url),nextDeps=createRequire(local.resolve('next/package.json'));
const babel=local('next/dist/compiled/babel/core');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Inbox from './components/CommercialInbox';createRoot(document.getElementById('root')).render(<Inbox instagramAvailable={false} facebookAvailable={false} whatsappAdminAvailable/>);`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},plugins:[{name:'synthetic-session',setup(b){
 b.onResolve({filter:/^styled-jsx\/style$/},()=>({path:nextDeps.resolve('styled-jsx/style')}));
 b.onLoad({filter:/\/components\/(CommercialInbox|WhatsAppAdminConversation)\.js$/},async a=>({contents:babel.transformSync(await readFile(a.path,'utf8'),{filename:a.path,babelrc:false,configFile:false,plugins:[local('next/dist/compiled/babel/plugin-syntax-jsx'),nextDeps('styled-jsx/babel')]}).code,loader:'jsx'}));
 b.onResolve({filter:/lib\/supabase$/},()=>({path:'session',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-local-only'}}}),getUser:async()=>({data:{user:null}})}};`}));
}}]});
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
 const u=new URL(req.url,'http://localhost');
 if(req.method!=='GET'){qa.state.writes++;res.writeHead(405);return res.end();}
 if(u.pathname==='/fixture'){
  const action=u.searchParams.get('action');if(['normal','error','empty'].includes(action)){qa.state.mode=action;qa.state.slow=false;}
  if(action==='slow'){qa.state.mode='normal';qa.state.slow=true;}
  if(action==='refresh')qa.state.revision++;
  if(['admin','asesor'].includes(action))qa.state.role=action;
  res.end('Fixture '+action+'; espera el polling de 10 segundos');return;
 }
 if(u.pathname==='/metrics'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({writes:qa.state.writes,reads:qa.state.rpcs.length,allowedRPCs:[...new Set(qa.state.rpcs)],mode:qa.state.mode,role:qa.state.role}));return;}
 if(u.pathname==='/api/operaciones/whatsapp-admin-inbox'){
  if(qa.state.slow)await new Promise(resolve=>setTimeout(resolve,5000));
  const r=await qa.request(Object.fromEntries(u.searchParams));res.writeHead(r.code,{'Content-Type':'application/json'});res.end(JSON.stringify(r.body));return;
 }
 if(u.pathname.startsWith('/api/')){res.writeHead(403);res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font-family:Arial"><div style="background:#fff3c4;padding:12px">QA AISLADA · datos y sesión sintéticos · sin conexión DEV/Meta<br>${['normal','error','empty','refresh','admin','asesor','slow'].map(a=>`<button onclick="fetch('/fixture?action=${a}').then(r=>r.text()).then(t=>document.getElementById('qa-status').textContent=t)">${a}</button>`).join('')}<span id="qa-status"></span></div><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
});
server.listen(0,'127.0.0.1',()=>console.log('QA_URL=http://127.0.0.1:'+server.address().port));
