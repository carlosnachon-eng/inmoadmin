export default async function handler(req, res) {
  const token = process.env.RESPOND_IO_TOKEN

  const hoy = new Date()
  const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  const hoyStr = hoy.toISOString().split('T')[0]

  try {
    // Jalar conversaciones con assignee
    const response = await fetch(
      `https://api.respond.io/v2/contact?limit=100`,
      { 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        } 
      }
    )
    const text = await response.text()
    res.status(200).json({ status: response.status, body: text.slice(0, 500) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
