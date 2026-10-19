import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const s=readFileSync(new URL('lib/messaging/facebook/messenger/attachmentManifest.js',root),'utf8');
test('media manifest stays server-side and omits provider identifiers and URLs',()=>{
 assert.match(s,/open\(c,'content',binding\(row\),row\.content_box\)/);
 assert.match(s,/row\.deleted/);
 assert.match(s,/retrievable:/);
 assert.doesNotMatch(s,/url:item|attachment_id:item/);
});
