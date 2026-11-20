// Memory-only UI QA; real component. No Meta/Supabase network or credentials.
import http from 'node:http';import {createRequire} from 'node:module';import path from 'node:path';
import {publicationFacts} from '../lib/messaging/commentAgent/verifiedPublication.js';
import {decideComment} from '../lib/messaging/commentAgent/decision.js';
const require=createRequire(path.join(process.env.WA_QA_DEPS,'package.json')),{build}=require('esbuild');
let approvals=0,posts=0;const rows={};for(const platform of ['instagram','facebook']){
 rows[platform]=[];
 for(const [operacion,ref,precio] of [['sale','a',2000000],['rental','c',18000]]){
  const event={platform,connection_ref:'1'.repeat(64),post_ref:'2'.repeat(64),comment_ref:ref.repeat(64),event_ref:'3'.repeat(64),owned:true,replies_verified:true,text:'precio',occurred_at:new Date().toISOString()};
  const property={id:'synthetic-property',public_id:'EMP-QA256',status:'published',operacion,precio,moneda:'MXN'};
  const db={from:()=>({select(){return this;},eq(){return this;},async limit(){return{data:[property]};}})};
  const facts=await publicationFacts({event,publication:{verified:true,platform,connection_ref:event.connection_ref,post_ref:event.post_ref,text:'https://emporioinmobiliario.com.mx/propiedades/EMP-QA256'},db,reference:()=> '4'.repeat(64)});
  rows[platform].push({...decideComment({event,facts}),platform,comment_ref:event.comment_ref,revision:ref.repeat(64),opportunity:true,destination:'SALES'});
 }
}
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Panel from './components/CommentReviewPanel';createRoot(document.getElementById('root')).render(<Panel/>);",loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},plugins:[{name:'session-fixture',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'session',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}};"}));}}]});
const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(u.pathname==='/mobile'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><h2>QA sintética · viewport CSS 390 × 844</h2><p>Sin Meta ni Supabase. No emula hardware móvil.</p><iframe title="QA móvil 390px" src="/" style="width:390px;height:844px;border:1px solid #ccc"></iframe>');}
 if(u.pathname==='/metrics'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({approvals,posts,real_sends:0}));}
 if(u.pathname==='/api/operaciones/comment-review'){
  const platform=u.searchParams.get('platform');if(!rows[platform]){res.writeHead(400);return res.end();}
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){posts++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);if(body.op==='approve'){const r=rows[platform].find(r=>r.comment_ref===body.comment&&r.revision===body.revision&&r.status==='proposed');if(r){r.status='approved';r.approved_text=body.text;approvals++;return res.end(JSON.stringify({status:'approved_not_sent'}));}return res.end(JSON.stringify({status:'stale_or_blocked'}));}return res.end(JSON.stringify({status:'evaluated'}));}
  return res.end(JSON.stringify({rows:rows[platform],sender:false}));
 }
 res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'");res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px Arial;margin:12px}button{padding:10px;margin:3px}main{max-width:850px;margin:auto}textarea{min-height:100px}</style><main><h2>QA sintética · sin conexión externa</h2><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>`);
});server.listen(0,'127.0.0.1',()=>console.log('QA_URL=http://127.0.0.1:'+server.address().port));
