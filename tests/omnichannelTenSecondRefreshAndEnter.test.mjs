import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldSendOnEnter} from '../lib/messaging/shared/composerKeyboard.js';

test('Enter sends; shift-Enter creates newline; IME and modifiers never submit',()=>{
 const base={key:'Enter',shiftKey:false,repeat:false,isComposing:false,nativeEvent:{isComposing:false},ctrlKey:false,altKey:false,metaKey:false};
 assert.equal(shouldSendOnEnter(base),true);
 for(const patch of [{shiftKey:true},{repeat:true},{isComposing:true},{nativeEvent:{isComposing:true}},{ctrlKey:true},{altKey:true},{metaKey:true},{key:'a'}])
  assert.equal(shouldSendOnEnter({...base,...patch}),false);
});
test('Unified list, Instagram history and Facebook history all poll at 10s and stop when hidden',()=>{
 const root=new URL('../',import.meta.url);
 const list=readFileSync(new URL('components/CommercialInbox.js',root),'utf8');
 const ig=readFileSync(new URL('components/InstagramBusinessInbox.js',root),'utf8');
 const fb=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
 assert.match(list,/setInterval\(\(\)=>\{void tick\(\)\},10000\)/);
 assert.match(list,/visibilityState!=='visible'/);
 assert.match(ig,/setInterval\(tick,10000\)/);
 assert.match(ig,/visibilityState!=='visible'/);
 assert.match(fb,/setInterval\(tick,10000\)/);
 assert.match(fb,/visibilityState==='visible'/);
 assert.match(fb,/historyPolling\.current/);
});
test('Both channel composers use the guarded Enter path through the existing form',()=>{
 const root=new URL('../',import.meta.url);
 for(const filename of ['FacebookMessengerConversation.js','InstagramBusinessInbox.js']){
  const source=readFileSync(new URL('components/'+filename,root),'utf8');
  assert.match(source,/onKeyDown=\{e=>\{if\(shouldSendOnEnter\(e\)\)/);
  assert.match(source,/e\.preventDefault\(\)/);
  assert.match(source,/e\.currentTarget\.form\?\.requestSubmit\(\)/);
 }
});
