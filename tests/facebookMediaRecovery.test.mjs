import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pages/api/operaciones/facebook-messenger-media.js',import.meta.url),'utf8');

test('fallback requires an authorized inbound event and validated cryptographic recipient',()=>{
 assert.match(source,/row\.kind!=='inbound'/);
 assert.match(source,/recipient\(c,row\)/);
 assert.match(source,/pageToken\(c,await store\.credential\(\)\)/);
});
test('fallback never takes arbitrary Graph identifiers from request',()=>{
 assert.match(source,/const \{mid\}=open\(c,'recipient',binding\(row\),row\.recipient_box\)/);
 assert.match(source,/body\?\.id!==mid/);
 assert.match(source,/item\.id!==attachment\.attachment_id/);
});
test('fallback keeps download restrictions and no send operation',()=>{
 assert.match(source,/reviewMediaUrl\(candidate\)/);
 assert.match(source,/maxRedirects:0/);
 assert.match(source,/secureDownload\(url/);
 assert.doesNotMatch(source,/method:'POST'/);
});
