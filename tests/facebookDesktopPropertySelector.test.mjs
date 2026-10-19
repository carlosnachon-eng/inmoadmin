import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/FacebookMessengerConversation.js',import.meta.url),'utf8');
test('desktop picker floats above height-constrained conversation',()=>{
 assert.match(source,/@media\(min-width:1001px\)/);
 assert.match(source,/\.fbPropertyPicker\{position:fixed/);
 assert.match(source,/max-height:min\(66vh,540px\)/);
});
test('result list scrolls independently while confirmation remains visible',()=>{
 assert.match(source,/className="fbPropertyList"/);
 assert.match(source,/className="fbPropertyFooter"/);
 assert.match(source,/\.fbPropertyPicker \.fbPropertyList\{flex:1/);
 assert.match(source,/\.fbPropertyPicker \.fbPropertyFooter\{flex-shrink:0/);
 assert.match(source,/onClick=\{prepareProperties\}>Preparar mensaje/);
});

test('shared property draft uses JS newline escapes, not literal slash characters',()=>{
 const begin=source.indexOf(' function prepareProperties(){');
 const end=source.indexOf(' const [pendingMedia',begin);
 const block=source.slice(begin,end);
 assert.equal(block.includes("'\\\\n'"),false);
 assert.equal(block.includes("'\\n'"),true);
});

test('appointment editor portals above Inbox on both mobile and desktop',()=>{
 assert.match(source,/createPortal\(/);
 assert.match(source,/document\.body/);
 assert.match(source,/zIndex:2147483000/);
 assert.match(source,/role="dialog"/);
 assert.match(source,/maxHeight:'min\(90dvh,800px\)'/);
 assert.match(source,/flexShrink:0,borderTop:/);
});
