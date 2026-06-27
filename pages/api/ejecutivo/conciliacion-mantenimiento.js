import { createClient } from '@supabase/supabase-js';
import { construirConciliacionMantenimiento } from '../../../lib/ejecutivo/conciliacionMantenimiento';
import { cargarMantenimientoConciliacion } from '../../../lib/ejecutivo/dataLoaders';
import { createQueryMetrics } from '../../../lib/ejecutivo/queryMetrics';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ROLES_BI = new Set(['admin', 'direccion']);
const EMAILS_DIRECCION = new Set(['carlos.nachon@emporioinmobiliario.mx']);

async function autenticarDireccion(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: 'Sesión requerida', status: 401 };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Sesión inválida', status: 401 };

  const { data: perfil, error: perfilError } = await supabase
    .from('profiles')
    .select('id, full_name, email, role_id')
    .eq('id', user.id)
    .maybeSingle();

  if (perfilError) return { error: perfilError.message, status: 500 };

  const email = (perfil?.email || user.email || '').toLowerCase();
  const role = perfil?.role_id || null;
  const autorizado = ROLES_BI.has(role) || EMAILS_DIRECCION.has(email);

  if (!autorizado) {
    return { error: 'No tienes permiso para consultar conciliación de mantenimiento', status: 403 };
  }

  return { user, perfil: { ...perfil, email } };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Falta configuración de Supabase' });
  }

  const auth = await autenticarDireccion(req);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  const metrics = createQueryMetrics();

  try {
    const datos = await cargarMantenimientoConciliacion(supabase, metrics);
    const conciliacion = construirConciliacionMantenimiento(datos);

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      generated_by: {
        user_id: auth.user.id,
        email: auth.perfil.email,
        role_id: auth.perfil.role_id,
      },
      ...conciliacion,
      _performance: metrics.summary({
        optimized: true,
        notes: [
          'Lectura movida del frontend a API interna.',
          'Se reemplazó select(*) por columnas explícitas.',
        ],
      }),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al construir conciliación de mantenimiento',
      _performance: metrics.summary(),
    });
  }
}
