import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const observer=readFileSync(new URL('lib/messaging/facebook/messenger/observer.js',root),'utf8');
test('Meta attachment URLs are never persisted in event payload',()=>{
 assert.match(observer,/attachment_id:/);
 assert.match(observer,/attachment_types:attachments\.map/);
 assert.doesNotMatch(observer,/a\.payload\.url|a\.url/);
 assert.match(observer,/row\.content_box=seal\(c,'content'/);
});
test('media-only incoming messages remain inbound for authorized read and response window',()=>{
 assert.match(observer,/text!==null\|\|attachments\.length\?'inbound'/);
 assert.match(observer,/row\.recipient_box=kind === 'inbound'/);
});
