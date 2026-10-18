import {createClient} from '@supabase/supabase-js';
import {authorizeShadowAdministrator} from '../../../lib/shadow/ai/apiAuth.js';
import {createBindingCheck} from '../../../lib/messaging/instagram/business/bindingCheck.js';
export const config={api:{bodyParser:{sizeLimit:'1kb'}}};
export default createBindingCheck({authorize:authorizeShadowAdministrator,getDb:()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})});
