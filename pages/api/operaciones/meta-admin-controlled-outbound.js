import {createClient} from '@supabase/supabase-js';
import {createControlledOutboundStore} from '../../../lib/messaging/metaAdminCapture/controlledOutboundStore.js';
import {createControlledOutboundOperator} from '../../../lib/messaging/metaAdminCapture/controlledOutboundOperator.js';

export const config={api:{bodyParser:{sizeLimit:'1kb'}},maxDuration:120};
export default createControlledOutboundOperator({makeStore(env){
  const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return {...createControlledOutboundStore(client),contextDb:client};
}});
