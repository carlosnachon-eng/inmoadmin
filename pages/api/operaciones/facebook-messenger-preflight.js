import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {createMessengerPreflight} from '../../../lib/messaging/facebook/messenger/preflight.js';
export const config={api:{bodyParser:{sizeLimit:'1kb'}}};
export default createMessengerPreflight({authorize:authorizeInboxStaff,getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
