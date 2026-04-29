export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.easybroker.com/v1/properties?limit=50&page=1", {
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
