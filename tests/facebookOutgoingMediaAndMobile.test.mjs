import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/FacebookMessengerConversation.js',import.meta.url),'utf8');
test('appointments have bounded scrollable panel and visible sticky footer',()=>{
 assert.match(source,/fbAppointmentPanel/);
 assert.match(source,/maxHeight:'min\(55vh,440px\)'/);
 assert.match(source,/position:'sticky',bottom:0/);
});
test('outbound media is not incorrectly fetched through inbound-only endpoint',()=>{
 assert.match(source,/r\.kind==='echo'\?/);
 assert.match(source,/vista previa pendiente/);
 assert.match(source,/<FacebookReceivedMedia/);
});
test('property message uses actual newlines, not literal slash-n',()=>{
 assert.ok(source.includes("].join('\\n');"));
 assert.ok(!source.includes("].join('\\\\n');"));
});
