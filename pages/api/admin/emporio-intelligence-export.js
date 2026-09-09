import { createClient } from '@supabase/supabase-js';
import {
  PROPERTY_EXPORT_SELECT,
  buildEmporioIntelligenceExport,
  EmporioExportValidationError,
} from '../../../lib/emporioIntelligenceExport.mjs';

const ADMIN_ROLES = new Set(['admin']);

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export default async function handler(req, res) {
  // This is intentionally a manual, authenticated download only.  It has no
  // scheduler, no write path, no token in source code, and no public access.
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Sesión requerida' });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Export no configurado' });
  }

  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await auth.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: 'Sesión inválida' });

  // The service role remains exclusively server-side.  It is used only after
  // validating the caller and only for the allow-listed projection below.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, role_id, active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ error: 'No se pudo validar autorización' });
  if (!profile?.active || !ADMIN_ROLES.has(profile.role_id)) return res.status(403).json({ error: 'Solo Admin puede generar este export' });

  const { data: properties, error: propertiesError } = await db
    .from('propiedades')
    .select(PROPERTY_EXPORT_SELECT)
    .order('id', { ascending: true });
  if (propertiesError) return res.status(500).json({ error: 'No se pudo leer inventario autorizado' });

  try {
    const payload = buildEmporioIntelligenceExport(properties || [], {
      observedAt: new Date().toISOString(),
      // The query is intentionally unfiltered over the authorized inventory.
      authoritativeFullSnapshot: true,
    });
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inmoadmin-emporio-export.json"');
    return res.status(200).send(JSON.stringify(payload));
  } catch (error) {
    // Keep row values, SQL, stack traces, and PII out of HTTP responses and
    // logs. The stable internal identifier and field name are safe enough for
    // an authenticated Admin to correct the mapping or source record.
    if (error instanceof EmporioExportValidationError) {
      return res.status(422).json({
        code: error.code,
        source_listing_id: error.sourceListingId,
        field: error.field,
      });
    }
    return res.status(422).json({ code: 'INVALID_EXPORT', field: 'export', source_listing_id: null });
  }
}
