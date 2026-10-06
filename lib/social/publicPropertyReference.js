// Parse only the existing first-party public listing URL contract. No fetch,
// redirects, DNS, social-link scraping, credentials or URL persistence.
const HOSTS = new Set(["emporioinmobiliario.com.mx", "www.emporioinmobiliario.com.mx"]);
export function publicPropertyReferences(text) {
  const urls = String(text || "").slice(0,12000).match(/https?:\/\/[^\s<>"']+/gi) || [];
  const references = new Set();
  for (const raw of urls.slice(0,8)) {
    try {
      const url = new URL(raw.replace(/[).,!?;]+$/, ""));
      if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password || url.port) continue;
      const match = url.pathname.match(/^\/propiedades\/(EMP-[A-Z0-9]{4,40})\/?$/);
      if (match) references.add(match[1]);
    } catch { /* unresolved, never network fallback */ }
  }
  return { hasLink: urls.length > 0, publicIds: [...references] };
}

export async function resolvePublicPropertyReference(db, rawText, explicitRef, durableReferences) {
  const parsed = durableReferences || publicPropertyReferences(rawText);
  const ids = [...new Set([explicitRef, ...parsed.publicIds].filter(Boolean))];
  if (ids.length !== 1) return { propertyId: null, linkStatus: parsed.hasLink ? "unresolved" : null };
  const result = await db.from("propiedades").select("id").eq("public_id", ids[0]).eq("status", "published").limit(2);
  if (result.error) throw result.error;
  return { propertyId: result.data?.length === 1 ? result.data[0].id : null,
    linkStatus: parsed.hasLink ? (result.data?.length === 1 ? "catalog_verified" : "unresolved") : null };
}
