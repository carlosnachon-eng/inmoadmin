import {createBusinessStore} from '../instagram/business/store.js';
import {tokenForComments} from '../instagram/business/tokenLifecycle.js';
import {projectBusinessComments} from '../instagram/business/comments.js';
import * as crypto from '../instagram/business/crypto.js';
import {associationOperation,associationStore,bindProperty} from './propertyAssociation.js';
import {inspectMetaComment} from './verifiedPublication.js';

// UI supplies only opaque review references. Native identifiers come from the
// authenticated, encrypted capture; no token refresh or dispatch capability.
export async function bindInstagramProperty({db,c,actor,store,operation,fetchImpl=fetch}){
 associationOperation(operation);
 if(operation?.op!=='bind_property'||c.senderEnabled||!actor.active||!['admin','gerente_ventas'].includes(actor.role_id))return {status:'association_target_denied'};
 const reviews=await store('list');
 if(!Array.isArray(reviews)||reviews.length>200)throw Error('batch');
 const matches=reviews.filter(r=>r.comment_ref===operation.comment&&r.revision===operation.revision);
 if(matches.length!==1)return {status:'association_target_denied'};
 const row=matches[0];
 if(row.platform!=='instagram'||row.connection_id!==c.connection)return {status:'association_target_denied'};
 const legacy=createBusinessStore(db,c.connection),raw=await legacy.comments(actor.id);
 if(!Array.isArray(raw)||raw.length>200)throw Error('batch');
 const captured=raw.filter(r=>r.comment_ref===row.comment_ref&&r.event_ref===row.event_ref);
 if(captured.length!==1)return {status:'association_target_denied'};
 const r=captured[0],p=projectBusinessComments({config:c,rows:[r]})[0];
 const event={...p,deleted:r.deleted===true,event_ref:r.event_ref,platform:'instagram',post_ref:r.media_ref,connection_ref:crypto.ref(c,'review-connection',c.connection),owned:true,nested:!!p.parent_id};
 if(event.deleted||event.nested)return {status:'association_target_denied'};
 const native=crypto.open(c,'comment-native',[r.comment_ref,r.media_ref,r.event_ref,new Date(r.occurred_at).toISOString()],r.native_box);
 const token=tokenForComments(c,await legacy.loadCredential(c.connection));
 const proof=await inspectMetaComment({platform:'instagram',account:c.account,comment:native.comment_id,post:native.media_id,token,fetchImpl});
 return bindProperty({operation,row,event,proof,c,actor,crypto,links:associationStore(db,'instagram',c,actor)});
}
