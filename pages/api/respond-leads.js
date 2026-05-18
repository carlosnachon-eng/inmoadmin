export default async function handler(req, res) {
  const token = process.env.RESPOND_IO_TOKEN
  const spaceId = '411886'

  const hoy = new Date()
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const hoyStr = hoy.toISOString().split('T')[0]

  try {
    const response = await fetch(
      `https://api.respond.io/v1/space/${spaceId}/report/user?startDate=${inicioMes}&endDate=${hoyStr}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await response.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
