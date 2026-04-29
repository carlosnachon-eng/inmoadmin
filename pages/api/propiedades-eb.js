export default async function handler(req, res) {
  try {
    const { page = 1, operacion = "rental", tipo, precioMin, precioMax, recamaras } = req.query;

    const params = new URLSearchParams();
    params.append("limit", "10");
    params.append("page", page);
    params.append("search[operation_types][]", operacion);
    params.append("search[statuses][]", "published");
    params.append("search[statuses][]", "reserved");
    if (tipo) params.append("search[property_types][]", tipo);
    if (precioMin) params.append("search[min_price]", precioMin);
    if (precioMax) params.append("search[max_price]", precioMax);
    if (recamaras) params.append("search[bedrooms_min]", recamaras);

    const url = `https://api.easybroker.com/v1/properties?${params.toString()}`;

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
