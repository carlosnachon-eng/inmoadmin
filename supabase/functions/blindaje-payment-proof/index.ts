import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { proofHandler } from './handler.mjs'
// Custom bearer authentication is the scoped 256-bit payment token, checked inside the handler.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
Deno.serve(proofHandler(() => db))
