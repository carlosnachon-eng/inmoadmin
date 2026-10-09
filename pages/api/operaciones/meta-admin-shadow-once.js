import { createClient } from '@supabase/supabase-js';
import { createShadowOnceSupabaseStore } from '../../../lib/messaging/metaAdminCapture/shadowOnceSupabase.js';
import { createShadowOnceOperator } from '../../../lib/messaging/metaAdminCapture/shadowOnceOperator.js';

export const config = { api:{ bodyParser:{ sizeLimit:'1kb' } }, maxDuration:120 };
export default createShadowOnceOperator({makeStore(env){
  const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return createShadowOnceSupabaseStore(client);
}});
