import {reviewDatabaseError} from './diagnostics.js';
const ref=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function associationOperation(body){
 if(body?.op!=='bind_property')return null;
 if(Object.keys(body).sort().join(',')!=='comment,confirmed,op,property_public_id,revision'||body.confirmed!==true
  ||!ref(body.comment)||!ref(body.revision)||!/^([A-Z0-9][A-Z0-9-]{2,79})$/.test(body.property_public_id||''))throw Error('association_operation');
 return body;
}
export function associationStore(db,platform,c,actor){
 return async(op,data)=>{const r=await db.rpc('comment_property_link_v1',{p_platform:platform,p_connection:c.connection,p_actor:actor.id,p_op:op,p_data:data});if(r.error)throw reviewDatabaseError(r.error);return r.data;};
}
export async function bindProperty({operation,row,event,proof,c,actor,crypto,links}){
 associationOperation(operation);
 if(!row||row.revision!==operation.revision||row.comment_ref!==event.comment_ref||row.event_ref!==event.event_ref
  ||event.deleted||proof.verified!==true||proof.deleted||!event.owned||event.nested||!['admin','gerente_ventas'].includes(actor.role_id)||c.senderEnabled)return {status:'association_target_denied'};
 // Decrypt the review before accepting a UI reference; Meta ownership/membership
 // must have been verified by inspectMetaComment before reaching this function.
 crypto.open(c,'commercial-review',[row.comment_ref,row.revision],row.decision_box);
 const evidence={source:'human_confirmed_publication',platform:event.platform,connection_ref:event.connection_ref,
  post_ref:event.post_ref,event_ref:event.event_ref,property_public_id:operation.property_public_id,actor:actor.id};
 return links('bind',{post_ref:event.post_ref,event_ref:event.event_ref,property_public_id:operation.property_public_id,
  evidence_box:crypto.seal(c,'commercial-property-link',[event.post_ref],evidence)});
}
export async function readPropertyAssociation({event,links,crypto,c}){
 const row=await links('read',{post_ref:event.post_ref});if(row===null)return null;
 if(!row||row.platform!==event.platform||row.connection_id!==c.connection||row.post_ref!==event.post_ref)throw Error('association_binding');
 const e=crypto.open(c,'commercial-property-link',[event.post_ref],row.evidence_box);
 if(e.source!=='human_confirmed_publication'||e.platform!==event.platform||e.connection_ref!==event.connection_ref||e.post_ref!==event.post_ref||e.actor!==row.confirmed_by||!e.property_public_id)throw Error('association_binding');
 return {property_id:row.property_id,public_id:e.property_public_id,source:'human_confirmed_publication'};
}
