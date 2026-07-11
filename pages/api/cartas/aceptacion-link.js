import { createClient } from "@supabase/supabase-js";
import { createCartaAcceptanceToken } from "../../../lib/cartaAcceptanceToken";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No autorizado" });

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: "No autorizado" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Falta id" });

  const acceptanceToken = createCartaAcceptanceToken(id);
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  return res.status(200).json({
    url: `${origin}/cartas/aceptar/${encodeURIComponent(id)}?token=${acceptanceToken}`,
  });
}
