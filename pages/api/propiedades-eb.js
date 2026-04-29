export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.easybroker.com/v1/properties?limit=10&page=1", {
      method: "GET",
      headers: {
        "X-Authorization": process.env.EASYBROKER_API_KEY,
        "accept": "application/json",
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
    return res.status(response.status).send(text);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
