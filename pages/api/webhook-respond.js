export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = req.body

    // Solo procesamos eventos de asignación
    const event = body?.event
    if (event !== 'contact.assignee.created') {
      return res.status(200).json({ ok: true, skipped: true })
    }

    const contacto = body?.contact
    const assignee = body?.assignee

    if (!assignee?.id) {
      return res.status(200).json({ ok: true, skipped: 'no assignee' })
    }

    // Mapeo de IDs de Respond.io a nombres
    const ASESORES = {
      1087997: 'Guillermo',
      1088026: 'Angélica',
      1088052: 'Rosario',
      1088058: 'Iván',
      1088068: 'Andrea',
      1088092: 'Ariannet',
    }

    const asesorNombre = ASESORES[assignee.id]
    if (!asesorNombre) {
      return res.status(200).json({ ok: true, skipped: 'not a team member' })
    }

    // Guardar en Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    await supabase.from('leads_respond').insert({
      fecha: new Date().toISOString().split('T')[0],
      asesor_id: assignee.id,
      asesor_nombre: asesorNombre,
      contacto_id: contacto?.id?.toString(),
      contacto_nombre: contacto?.firstName || contacto?.lastName || 'Sin nombre',
      canal: body?.channel?.type || 'desconocido',
      conversation_id: body?.conversation?.id?.toString(),
    })

    res.status(200).json({ ok: true, asesor: asesorNombre })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
