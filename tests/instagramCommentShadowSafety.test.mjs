import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('../lib/messaging/instagram/business/comments.js',import.meta.url),'utf8');
const cron=readFileSync(new URL('../pages/api/cron/instagram-comment-automation.js',import.meta.url),'utf8');
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const snippet=code.match(/export function classifyBusinessCommentAutomation\([\s\S]*?(?=\nexport (?:async )?function )/)?.[0];
assert.ok(snippet,'classifier export exists');
const classify=new Function('open','binding','fold',snippet.replace(/^export /,'')+'; return classifyBusinessCommentAutomation;')((_c,_purpose,_binding,box)=>box,()=>[],fold);
const row=(text,overrides={})=>({occurred_at:'2026-10-18T12:00:00.000Z',content_box:{text,...overrides}});
const classifyText=(text,overrides={})=>classify({config:{},row:row(text,overrides),now:Date.parse('2026-10-18T13:00:00.000Z')});
test('only exact safe commercial questions are commercial',()=>{
 for(const text of ['precio','info','información','me interesa','¿Cuánto cuesta?','ubicación','informes porfa']){
  assert.equal(classifyText(text).classification,'commercial',text);
 }
});
test('mixed, negative, or sensitive comments require review',()=>{
 for(const text of ['precio pero es fraude','no quiero info, me engañaron','cuánto cuesta denunciar','precio excesivo, qué abuso','ubicación de la oficina para reclamar','dónde está mi depósito','info: no han respondido','me interesa denunciar un problema','qué mal servicio','precio y condiciones ilegales']){
  assert.equal(classifyText(text).classification,'review',text);
 }
});
test('ambiguous and nested comments do not auto qualify',()=>{
 assert.equal(classifyText('¿Tienen más fotos?').classification,'review');
 assert.equal(classifyText('precio',{parent_id:'123'}).classification,'review');
 assert.equal(classifyText('👏').classification,'ignored');
});
test('expired comments do not auto qualify',()=>{
 assert.equal(classify({config:{},row:{occurred_at:'2026-10-01T00:00:00.000Z',content_box:{text:'precio'}},now:Date.parse('2026-10-18T13:00:00Z')}).classification,'expired');
});
test('shadow and outbound use separate positive gates',()=>{
 assert.match(cron,/mode!=='shadow'&&mode!=='outbound'/);
 assert.match(cron,/INSTAGRAM_COMMENT_AUTOMATION_OUTBOUND_ENABLED/);
 assert.match(cron,/dryRun:!outbound/);
 assert.match(code,/if\(dryRun\)return\{status:'shadow_commercial'/);
 assert.match(code,/if\(!c\?\.senderEnabled\)return\{status:'disabled'/);
});
