import {createClient} from '@supabase/supabase-js';
import {createMessengerHealthApi} from '../../../lib/messaging/facebook/messenger/health.js';
export const config={maxDuration:60};
export default createMessengerHealthApi({getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
