import {createClient} from '@supabase/supabase-js';
import {authorizeShadowAdministrator} from '../../../lib/shadow/ai/apiAuth.js';
import {createInboxReader} from '../../../lib/messaging/metaAdminInbox/read.js';
import {createInboxHandler} from '../../../lib/messaging/metaAdminInbox/api.js';
export default createInboxHandler({authorize:authorizeShadowAdministrator,reader:()=>createInboxReader({
 db:createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}})
})});
