import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {createMessengerInboxApi} from '../../../lib/messaging/facebook/messenger/inbox.js';
export default createMessengerInboxApi({authorize:authorizeInboxStaff,getDb:()=>createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
 {auth:{persistSession:false,autoRefreshToken:false}})});
