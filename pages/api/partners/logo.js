import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null

const allowedLogoTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

async function authenticate(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { error: 'Sesion requerida', status: 401 }

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) return { error: 'Sesion invalida', status: 401 }

  const { data: perfil, error: perfilError } = await supabase
    .from('profiles')
    .select('id, email, role_id')
    .eq('id', user.id)
    .maybeSingle()

  if (perfilError) return { error: perfilError.message, status: 500 }
  if (!perfil) return { error: 'Perfil no encontrado', status: 403 }
  if (perfil.role_id === 'admin') return { user, perfil }

  const { data: permiso, error: permisoError } = await supabase
    .from('permisos_modulo')
    .select('puede_editar')
    .eq('role_id', perfil.role_id)
    .eq('modulo', 'poliza')
    .maybeSingle()

  if (permisoError) return { error: permisoError.message, status: 500 }
  if (!permiso?.puede_editar) return { error: 'No tienes permiso para editar partners', status: 403 }

  return { user, perfil }
}

function parseLogo(logoFile) {
  if (!logoFile?.dataUrl) throw new Error('Falta el logo.')
  if (!allowedLogoTypes.has(logoFile.type)) throw new Error('El logo debe ser PNG, JPG o WebP.')
  if (Number(logoFile.size || 0) > 2 * 1024 * 1024) throw new Error('El logo no debe pesar mas de 2 MB.')

  const match = String(logoFile.dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) throw new Error('El logo no tiene un formato valido.')

  const ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1]
  return {
    contentType: match[1],
    ext,
    buffer: Buffer.from(match[2], 'base64'),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Metodo no permitido' })
  if (!supabase) return res.status(500).json({ ok: false, error: 'Falta configuracion de Supabase' })

  try {
    const auth = await authenticate(req)
    if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error })

    const { agency_id, logo_file } = req.body || {}
    if (!agency_id) return res.status(400).json({ ok: false, error: 'Falta agency_id' })

    const logo = parseLogo(logo_file)
    const path = `partner-logos/${agency_id}.${logo.ext}`
    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .upload(path, logo.buffer, { contentType: logo.contentType, upsert: true })
    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('documentos').getPublicUrl(path)
    const logoUrl = data?.publicUrl || null
    if (!logoUrl) throw new Error('No se pudo generar la URL publica del logo.')

    const { error: updateError } = await supabase
      .from('partner_agencies')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', agency_id)
    if (updateError) throw updateError

    return res.status(200).json({ ok: true, logo_url: logoUrl })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message })
  }
}
