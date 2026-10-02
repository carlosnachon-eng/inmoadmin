import { loadMaterialBytes } from "./assets.js";
import { VERSION_FIELDS } from "./delivery.js";
import { verifyMaterialLink } from "./links.js";
import { materialsEnabled } from "./policy.js";

export function createMaterialDownloadHandler({ createAdmin, env = process.env, now = Date.now }) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(req.method)) return res.status(405).end();
    try {
      if (!materialsEnabled(env)) return res.status(404).end();
      const token = verifyMaterialLink(req.query?.t, env, now());
      if (!token) return res.status(404).end();
      const admin = createAdmin();
      const { data: row, error } = await admin.from("owner_material_deliveries")
        .select("version_id,status,link_expires_at").eq("id", token.deliveryId).maybeSingle();
      if (error || !["dispatching", "sent", "uncertain"].includes(row?.status) ||
          Math.floor(Date.parse(row.link_expires_at) / 1000) !== token.expiry) return res.status(404).end();
      const version = await admin.from("owner_approved_material_versions").select(VERSION_FIELDS).eq("id", row.version_id).maybeSingle();
      const v = version.data;
      if (version.error || !v?.active || Date.parse(v.valid_from) > now() || Date.parse(v.valid_until) <= now()) return res.status(404).end();
      const bytes = await loadMaterialBytes(admin, v);
      // Recheck after Storage I/O; no CDN redirect/cache can outlive this check.
      if (!verifyMaterialLink(req.query.t, env, now())) return res.status(404).end();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${v.material_code}.pdf"`);
      res.setHeader("Content-Length", String(bytes.length));
      return res.status(200).end(req.method === "HEAD" ? undefined : bytes);
    } catch { return res.status(404).end(); }
  };
}
