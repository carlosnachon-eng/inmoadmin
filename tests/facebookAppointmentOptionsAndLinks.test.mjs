import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const api=readFileSync(new URL('pages/api/operaciones/facebook-messenger-appointments.js',root),'utf8');
const ui=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
test('GET options reaches advisor and property query instead of list',()=>{
 assert.match(api,/req\.method==='GET'\?\(req\.query\?\.op==='options'\?'options':'list'\)/);
 assert.match(api,/if\(op==='options'\)/);
});
test('Facebook messages linkify URLs safely as Instagram does',()=>{
 assert.match(ui,/function FacebookLinkifiedText/);
 assert.match(ui,/rel="noopener noreferrer"/);
 assert.match(ui,/<FacebookLinkifiedText value=\{r\.text\}/);
});
