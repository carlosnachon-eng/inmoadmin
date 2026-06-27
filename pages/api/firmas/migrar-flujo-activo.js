export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  return res.status(410).json({
    ok: false,
    error: 'La migración automática de flujos activos fue deshabilitada. Usa la restauración de flujo completo.',
    usar: '/api/firmas/restaurar-flujo-activo',
  })
}
