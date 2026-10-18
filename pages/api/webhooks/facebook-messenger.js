import {createClient} from '@supabase/supabase-js';
import {createMessengerWebhook} from '../../../lib/messaging/facebook/messenger/api.js';
export const config={api:{bodyParser:false}};
export default createMessengerWebhook({getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
