import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../pages/api/operaciones/facebook-messenger-media.js',import.meta.url),'utf8');
test('Messenger audio accepts MP4 video-detected container as Instagram does',()=>{
 assert.match(route,/audio:\['audio\/mpeg','audio\/ogg','audio\/mp4','video\/mp4'\]/);
 assert.match(route,/attachment\.type==='audio'&&mime==='video\/mp4'\?'audio\/mp4'/);
 assert.match(route,/media\.headerMime!==responseMime/);
});
test('Messenger media remains read-only and access scoped',()=>{
 assert.match(route,/fb_messenger_read_v1/);
 assert.match(route,/maxRedirects:0/);
 assert.match(route,/detectMime\(media\.buffer\)/);
});
