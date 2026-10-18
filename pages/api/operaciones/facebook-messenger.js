import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {createMessengerManualApi} from '../../../lib/messaging/facebook/messenger/api.js';
export const config={api:{bodyParser:{sizeLimit:'4kb'}}};
export default createMessengerManualApi({authorize:authorizeInboxStaff,getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
