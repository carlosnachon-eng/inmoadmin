export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  return res.status(410).json({
    ok: false,
    error: 'La creación manual de Firmas está deshabilitada. Crea el expediente desde un recibo de apartado.',
    crear_desde: '/api/recibos/trigger-firmas',
  })
}
