import { createClient } from '@supabase/supabase-js';
import { createInstagramObserverHandler, IG_DEV_REF } from '../../../lib/messaging/instagram/observer.js';

export const config = { api: { bodyParser: false }, maxDuration: 10 };
export default createInstagramObserverHandler({ getDb: () => {
  // Separate DEV client. Never fall back to the general production client.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${IG_DEV_REF}.supabase.co`
    || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('dev_database_required');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
} });
