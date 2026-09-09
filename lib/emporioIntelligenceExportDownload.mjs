import { validateEmporioIntelligenceExport } from './emporioIntelligenceExport.mjs';

export class ExportDownloadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function canDownloadEmporioIntelligenceExport(profile) {
  return profile?.active !== false && profile?.role_id === 'admin';
}

export function exportFilenameUtc(now = new Date()) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:-]/g, '');
  return `emporio-intelligence-export-${iso}.json`;
}

export async function requestEmporioIntelligenceExport({
  getSession,
  fetchImpl,
  now = new Date(),
  endpoint = '/api/admin/emporio-intelligence-export',
}) {
  const { data: { session } = {} } = await getSession();
  if (!session?.access_token) throw new ExportDownloadError('SESSION_REQUIRED');

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch {
    throw new ExportDownloadError('NETWORK_ERROR');
  }

  if (response.status === 401) throw new ExportDownloadError('UNAUTHORIZED');
  if (response.status === 403) throw new ExportDownloadError('FORBIDDEN');
  if (!response.ok) throw new ExportDownloadError('EXPORT_FAILED');

  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ExportDownloadError('INVALID_RESPONSE');
  }

  const rawJson = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawJson);
    validateEmporioIntelligenceExport(payload);
  } catch {
    throw new ExportDownloadError('INVALID_RESPONSE');
  }

  return { filename: exportFilenameUtc(now), rawJson };
}

export function exportErrorMessage(error) {
  switch (error?.code) {
    case 'SESSION_REQUIRED': return 'Tu sesión expiró. Inicia sesión de nuevo antes de exportar.';
    case 'UNAUTHORIZED': return 'La sesión no fue aceptada. Inicia sesión de nuevo.';
    case 'FORBIDDEN': return 'No tienes permiso para generar este export.';
    case 'NETWORK_ERROR': return 'No se pudo conectar para generar el export. No se descargó ningún archivo.';
    default: return 'No se pudo validar el export. No se descargó ningún archivo.';
  }
}
