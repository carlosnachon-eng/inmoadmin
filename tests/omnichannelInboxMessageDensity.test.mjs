import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const fb=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
const ig=readFileSync(new URL('components/InstagramBusinessInbox.js',root),'utf8');
test('Instagram embedded view has collapsible contact panel rather than fixed 280px column',()=>{
 assert.match(ig,/detailsExpanded,setDetailsExpanded/);
 assert.match(ig,/inboxShell\.embedded\{position:relative;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(ig,/inboxShell\.embedded\.detailsExpanded \.detailsPane\{display:block\}/);
 assert.match(ig,/inboxShell\.embedded \.mobileAliasButton\{display:block\}/);
 assert.match(ig,/aria-label="Cerrar ficha"/);
});
test('Facebook and Instagram messages have compact desktop padding and gaps',()=>{
 assert.match(fb,/\.history\{[^}]*gap:6px;padding:12px 18px/);
 assert.match(fb,/\.bubble\{[^}]*padding:6px 10px/);
 assert.match(ig,/\.messages\{[^}]*padding:12px 18px;[^}]*gap:6px/);
 assert.match(ig,/\.bubble\{[^}]*padding:6px 10px/);
});
test('small screen bubble text remains readable',()=>{
 assert.match(ig,/@media\(max-width:760px\)\{\.messages\{gap:9px\}\.bubble p\{font-size:14px/);
 assert.match(fb,/@media\(max-width:760px\)\{\.history\{gap:9px\}\.bubble p\{font-size:13\.5px/);
});
