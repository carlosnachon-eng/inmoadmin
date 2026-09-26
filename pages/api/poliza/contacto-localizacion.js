import { createClient } from '@supabase/supabase-js'
import { readInternalContactLocation } from '../../../lib/poliza/contactoLocalizacionServer'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Metodo no permitido' })
  }
  if (process.env.NEXT_PUBLIC_BLINDAJE_CONTACTO_LOCALIZACION_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Modulo no habilitado' })
  }
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1]
  if (!token) return res.status(401).json({ error: 'Sesion requerida' })
  // No caller-supplied solicitud, operation or agency can change the authorized source.
  if (Object.keys(req.query).some(key => key !== 'expedienteId')) {
    return res.status(400).json({ error: 'Parametros no permitidos' })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !secret) return res.status(503).json({ error: 'Lector interno no disponible' })
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const scoped = createClient(url, anon, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } })
  const service = createClient(url, secret, options)
  try {
    const result = await readInternalContactLocation({ scoped, service, token, expedienteId: req.query.expedienteId })
    return res.status(result.status).json(result.body)
  } catch {
    return res.status(503).json({ error: 'No fue posible consultar las fuentes autorizadas' })
  }
}
