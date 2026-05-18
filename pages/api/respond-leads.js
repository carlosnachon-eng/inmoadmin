export default async function handler(req, res) {
  const token = process.env.RESPOND_IO_TOKEN

  const ASESORES = [
    { nombre: 'Guillermo', id: 1087997 },
    { nombre: 'Angélica', id: 1088026 },
    { nombre: 'Rosario', id: 1088052 },
    { nombre: 'Iván', id: 1088058 },
    { nombre: 'Andrea', id: 1088068 },
    { nombre: 'Ariannet', id: 1088092 },
  ]

  try {
    const results = await Promise.all(
      ASESORES.map(async (asesor) => {
        const response = await fetch(
          `https://api.respond.io/v2/conversations?assigneeId=${asesor.id}&limit=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const text = await response.text()
        return { 
          nombre: asesor.nombre, 
          status: response.status, 
          body: text.slice(0, 200) 
        }
      })
    )
    res.status(200).json(results)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
