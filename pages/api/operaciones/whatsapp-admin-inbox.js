import {createClient} from '@supabase/supabase-js';
import {authorizeShadowAdministrator} from '../../../lib/shadow/ai/apiAuth.js';
import {createInboxReader} from '../../../lib/messaging/metaAdminInbox/read.js';
import {createWhatsAppAdminHandler,whatsappAdminPreviewAllowed} from '../../../lib/messaging/whatsappAdmin/inbox.js';

export default createWhatsAppAdminHandler({
 allowed:()=>whatsappAdminPreviewAllowed(process.env),
 authorize:authorizeShadowAdministrator,
 reader:()=>createInboxReader({includeContext:false,db:createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}})})
});
