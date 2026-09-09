import { validateEmporioIntelligenceExport } from './emporioIntelligenceExport.mjs';

export class ExportDownloadError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.status = details.status || null;
    this.safeCode = details.safeCode || null;
    this.sourceListingId = details.sourceListingId || null;
    this.field = details.field || null;
  }
}

const SAFE_ERROR_CODES = new Set(['MISSING_REQUIRED_FIELD', 'INVALID_FIELD', 'UNSUPPORTED_ENUM', 'INVALID_EXPORT']);
const SAFE_FIELDS = new Set(['id', 'ciudad', 'estado', 'moneda', 'operacion', 'tipo', 'precio', 'created_at', 'updated_at', 'listing', 'export']);
const safeDiagnostic = (payload) => ({
  safeCode: SAFE_ERROR_CODES.has(payload?.code) ? payload.code : null,
  sourceListingId: typeof payload?.source_listing_id === 'string' && /^inmoadmin:[^\s]+$/.test(payload.source_listing_id)
    ? payload.source_listing_id : null,
  field: SAFE_FIELDS.has(payload?.field) ? payload.field : null,
});

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

  if (response.status === 401) throw new ExportDownloadError('UNAUTHORIZED', { status: response.status });
  if (response.status === 403) throw new ExportDownloadError('FORBIDDEN', { status: response.status });
  if (!response.ok) {
    let diagnostic = {};
    try { diagnostic = safeDiagnostic(JSON.parse(await response.text())); } catch {}
    throw new ExportDownloadError('EXPORT_FAILED', { status: response.status, ...diagnostic });
  }

  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ExportDownloadError('INVALID_RESPONSE', { status: response.status });
  }

  const rawJson = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawJson);
    validateEmporioIntelligenceExport(payload);
  } catch {
    throw new ExportDownloadError('INVALID_RESPONSE', { status: response.status });
  }

  return { filename: exportFilenameUtc(now), rawJson };
}

export function exportErrorMessage(error) {
  const diagnostic = [
    error?.status ? `HTTP ${error.status}` : null,
    error?.safeCode ? `Código: ${error.safeCode}` : null,
    error?.sourceListingId ? `Listing: ${error.sourceListingId}` : null,
    error?.field ? `Campo: ${error.field}` : null,
  ].filter(Boolean).join(' · ');
  switch (error?.code) {
    case 'SESSION_REQUIRED': return 'Tu sesión expiró. Inicia sesión de nuevo antes de exportar.';
    case 'UNAUTHORIZED': return 'La sesión no fue aceptada. Inicia sesión de nuevo.';
    case 'FORBIDDEN': return 'No tienes permiso para generar este export.';
    case 'NETWORK_ERROR': return 'No se pudo conectar para generar el export. No se descargó ningún archivo.';
    default: return `${diagnostic ? `${diagnostic}. ` : ''}No se pudo validar el export. No se descargó ningún archivo.`;
  }
}
