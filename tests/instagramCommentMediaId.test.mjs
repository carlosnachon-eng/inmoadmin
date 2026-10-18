import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/messaging/instagram/business/comments.js',import.meta.url),'utf8');
test('source media IDs are validated as numeric native Instagram IDs',()=>{
 const fn=source.match(/export async function lookupBusinessCommentMedia[\s\S]*?(?=\nexport )/)?.[0];
 assert.ok(fn,'comment media lookup exists');
 assert.ok(fn.includes(String.raw`/^\d{1,32}$/`),'must match numeric media IDs');
 assert.ok(!fn.includes(String.raw`/^\\d{1,32}$/`),'must not match a literal backslash');
 assert.match('18000000000000000',/^\d{1,32}$/);
 assert.doesNotMatch('unknown',/^\d{1,32}$/);
});
