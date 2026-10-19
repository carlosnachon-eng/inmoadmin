import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const inbox=readFileSync(new URL('../components/CommercialInbox.js',import.meta.url),'utf8');
const fb=readFileSync(new URL('../components/FacebookMessengerConversation.js',import.meta.url),'utf8');
test('desktop inbox prioritizes conversation height and leaves mobile breakpoint',()=>{
 assert.match(inbox,/height:calc\(100dvh - 118px\)/);
 assert.match(inbox,/grid-template-columns:clamp\(250px,25%,330px\)/);
 assert.match(inbox,/@media\(max-width:760px\)/);
});
test('Facebook details toggle is visible and panel remains closed by default',()=>{
 assert.match(fb,/detailsOpen,setDetailsOpen\]=useState\(false\)/);
 assert.match(fb,/\.fbDetails\{display:none;position:absolute/);
 assert.match(fb,/\.fbDetails\.open\{display:flex\}/);
 assert.match(fb,/\.mobileDetails\{display:inline-block\}/);
});
test('desktop messages use bounded widths instead of giant bubbles',()=>{
 assert.match(fb,/max-width:min\(70%,460px\)/);
});
