import {createClient} from '@supabase/supabase-js';
import {createBusinessWebhook} from '../../../lib/messaging/instagram/business/api.js';
export const config={api:{bodyParser:false}};
export default createBusinessWebhook({getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
