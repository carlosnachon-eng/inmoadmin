import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {businessConfig} from '../../../lib/messaging/instagram/business/config.js';
import {createBusinessStore} from '../../../lib/messaging/instagram/business/store.js';
import {projectBusinessComments} from '../../../lib/messaging/instagram/business/comments.js';
import {ref} from '../../../lib/messaging/instagram/business/crypto.js';
import {createCommentObservationApi,commentObservationAllowed} from '../../../lib/messaging/commentAgent/api.js';

export default createCommentObservationApi({authorize:authorizeInboxStaff,
 allowed:()=>commentObservationAllowed(process.env),loadInstagram:async actor=>{
  const c=businessConfig(process.env);if(!c||c.production)throw Error('configuration');
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const raw=await createBusinessStore(db,c.connection).comments(actor.id);
  if(!Array.isArray(raw)||raw.length>200)throw Error('batch');
  const projected=projectBusinessComments({config:c,rows:raw});
  return projected.map((row,i)=>({event:{platform:'instagram',connection_ref:ref(c,'comment-review-connection',c.connection),
   comment_ref:row.comment_ref,post_ref:row.media_ref,event_ref:raw[i].event_ref,occurred_at:row.occurred_at,
   text:row.text,owned:true,nested:Boolean(row.parent_id),reply_status:row.reply_status,automation_status:row.automation_status,
   replies_verified:false,live:row.media_product_type==='LIVE'},facts:null,capability:null}));
 }});
