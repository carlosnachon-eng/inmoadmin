import { createClient } from '@supabase/supabase-js'
import { getEtapas } from '../../../lib/firmasEtapas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { status } = req.query
    const query = supabase
      .from('firmas')
      .select('*, firma_etapas(*)')
      .order('created_at', { ascending: false })

    if (status) query.eq('status', status)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ firmas: data })
  }

  return res.status(405).end()
}
