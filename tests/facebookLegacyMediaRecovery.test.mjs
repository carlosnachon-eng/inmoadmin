import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pages/api/operaciones/facebook-messenger-media.js',import.meta.url),'utf8');
test('legacy fallback accepts only a single attachment from the bound message',()=>{
 assert.match(source,/recipient\(c,row\)/);
 assert.match(source,/body\?\.id!==mid/);
 assert.match(source,/body\.attachments\.data\.length!==1\|\|index!==0/);
});
test('stored IDs still require exact Graph ID equality',()=>{
 assert.match(source,/item\.id!==attachment\.attachment_id/);
});
test('download is bounded and bytes must match encrypted category',()=>{
 assert.match(source,/secureDownload\(url,\{maxBytes,maxRedirects:0,timeoutMs:10000\}\)/);
 assert.match(source,/detectMime\(media\.buffer\)/);
 assert.match(source,/allowed\[attachment\.type\]\.includes\(mime\)/);
});
test('fallback does not send messages or log credentials',()=>{
 assert.doesNotMatch(source,/method:'POST'/);
 assert.doesNotMatch(source,/console\.log\(token/);
});
