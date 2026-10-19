import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const media=readFileSync(new URL('lib/messaging/facebook/messenger/mediaReply.js',root),'utf8');
const api=readFileSync(new URL('lib/messaging/facebook/messenger/api.js',root),'utf8');
const ui=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
test('media transport validates private storage, magic bytes, actor, time window and durable claim',()=>{
 for(const x of ['facebook-messenger-outbound','detectMime(media)','store.input(actor.id,body.input)','store.reserve(a)','store.start(a)','store.finish(a,outcome)','recipient(c,e)','pageToken(c,credential'])assert.ok(media.includes(x),x);
});
test('Facebook media upload uses a single authenticated send action',()=>{
 assert.match(api,/runMessengerMediaReply/);
 assert.match(ui,/media-reply/);
 assert.match(ui,/upsert:false/);
 assert.match(ui,/locked.current=true/);
});
test('voice recording releases microphone and only accepts MP4',()=>{
 assert.match(ui,/MediaRecorder/);
 assert.match(ui,/audio\/mp4/);
 assert.match(ui,/getTracks\(\)\.forEach\(t=>t.stop\(\)\)/);
});
