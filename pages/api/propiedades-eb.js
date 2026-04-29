export default async function handler(req, res) {
  try {
    const { page = 1, operacion = "rental", tipo, precioMin, precioMax, recamaras } = req.query;

    let url = `https://api.easybroker.com/v1/properties?limit=10&page=${page}`;
    url += `&search[operation_types][]=${operacion}`;
    if (tipo) url += `&search[property_types][]=${tipo}`;
    if (precioMin) url += `&search[min_price]=${precioMin}`;
    if (precioMax) url += `&search[max_price]=${precioMax}`;
    if (recamaras) url += `&search[bedrooms_min]=${recamaras}`;

    const response = await fetch(url, {
      headers: {
        "X-Authorization": process.env.EASYBROKER_API_KEY,
        "accept": "application/json",
      },
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
