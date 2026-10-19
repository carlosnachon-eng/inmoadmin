import {open,binding} from './crypto.js';
import {isRef} from './config.js';

// Safe, read-only projection for the future media viewer. No transient Meta URL
// or attachment identifier is ever returned to the browser.
export function projectMessengerAttachmentManifest(c,row){
 if(row?.connection_id!==c.connection||!isRef(row.thread_ref)||!isRef(row.event_ref)
  ||!isRef(row.message_ref)||row.deleted||!['inbound','echo'].includes(row.kind))throw Error('media_denied');
 const content=open(c,'content',binding(row),row.content_box);
 const items=Array.isArray(content?.attachments)?content.attachments.slice(0,20):[];
 return items.map((item,index)=>({
  index,type:['image','audio','video','file'].includes(item?.type)?item.type:'unsupported',
  retrievable:typeof item?.attachment_id==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(item.attachment_id)
 }));
}
