import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const inbox=readFileSync(new URL('components/CommercialInbox.js',root),'utf8');
const ig=readFileSync(new URL('components/InstagramBusinessInbox.js',root),'utf8');

test('Instagram embedded header uses resolved unified contact name',()=>{
 assert.match(inbox,/externalDisplayName=/);
 assert.match(ig,/externalDisplayName=''/);
 assert.match(ig,/\|\|externalDisplayName\|\|/);
 assert.match(ig,/Contacto de Instagram/);
});
test('Instagram thread previews use authorized history and latest message without expanding permissions',()=>{
 assert.match(inbox,/inboxRequest\('instagram','history',\{thread:t.thread_ref\}\)/);
 assert.match(inbox,/const latest=\(Array\.isArray\(result\.rows\)/);
 assert.match(inbox,/preview/);
 assert.match(inbox,/latest\.text\.trim\(\)\.replace\(\/\\s\+\/g,' '\)/);
 assert.match(inbox,/t\.preview\|\|'Instagram Direct'/);
});
test('missing profile data does not erase existing contact name',()=>{
 assert.match(inbox,/name\?\{profile_name:name\}:\{\}/);
 assert.match(inbox,/username\?\{profile_username:username\}:\{\}/);
});
