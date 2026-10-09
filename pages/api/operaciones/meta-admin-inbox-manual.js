import {createClient} from '@supabase/supabase-js';
import {authorizeShadowAdministrator} from '../../../lib/shadow/ai/apiAuth.js';
import {createManualStore} from '../../../lib/messaging/metaAdminInbox/manual.js';
import {createManualHandler} from '../../../lib/messaging/metaAdminInbox/manualApi.js';
export const config={api:{bodyParser:{sizeLimit:'12kb'}}};
export default createManualHandler({authorize:authorizeShadowAdministrator,store:()=>createManualStore(createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}
))});
