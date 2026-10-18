import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {createBusinessInboxApi} from '../../../lib/messaging/instagram/business/api.js';
export const config={maxDuration:120,api:{bodyParser:{sizeLimit:'8kb'}}};
export default createBusinessInboxApi({authorize:authorizeInboxStaff,getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
