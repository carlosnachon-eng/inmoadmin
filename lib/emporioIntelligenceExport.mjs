/**
 * Pure, allow-listed transformation for the Emporio Intelligence export.
 *
 * This module deliberately accepts only the inventory projection declared in
 * PROPERTY_EXPORT_COLUMNS.  Do not pass `select('*')` data to it: the export
 * boundary is intended to make accidental PII disclosure auditable.
 */

export const PROPERTY_EXPORT_COLUMNS = [
  'id',
  'public_id',
  'titulo',
  'operacion',
  'precio',
  'moneda',
  'tipo',
  'recamaras',
  'banos',
  'estacionamientos',
  'm2_construccion',
  'm2_terreno',
  'direccion',
  'colonia',
  'ciudad',
  'estado',
  'mostrar_ubicacion_exacta',
  'status',
  'created_at',
  'updated_at',
];

export const PROPERTY_EXPORT_SELECT = PROPERTY_EXPORT_COLUMNS.join(',');

const operationMap = new Map([
  ['sale', 'SALE'],
  ['venta', 'SALE'],
  ['rent', 'RENT'],
  ['rental', 'RENT'],
  ['renta', 'RENT'],
  ['arrendamiento', 'RENT'],
]);

const propertyTypeMap = new Map([
  ['house', 'HOUSE'], ['casa', 'HOUSE'],
  ['apartment', 'APARTMENT'], ['departamento', 'APARTMENT'], ['depto', 'APARTMENT'],
  ['land', 'LAND'], ['terreno', 'LAND'], ['lote', 'LAND'],
  ['commercial', 'COMMERCIAL'], ['local', 'COMMERCIAL'], ['comercial', 'COMMERCIAL'],
  ['office', 'OFFICE'], ['oficina', 'OFFICE'],
  // These are real Inmoadmin inventory types, but V1 has no more-specific
  // canonical category for them. They remain explicit rather than guessed.
  ['edificio', 'OTHER'], ['bodega', 'OTHER'], ['nave industrial', 'OTHER'],
  ['consultorio', 'OTHER'], ['hotel', 'OTHER'],
]);

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const normalizedText = (value) => text(value)
  ?.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');
const finiteNumber = (value, field, { required = false } = {}) => {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`missing ${field}`);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`invalid ${field}`);
  return number;
};

function normalizedEnum(value, map, field, fallback = null) {
  const normalized = normalizedText(value);
  if (!normalized && fallback) return fallback;
  const mapped = normalized && map.get(normalized);
  if (!mapped) throw new Error(`unsupported ${field}: ${String(value)}`);
  return mapped;
}

export class EmporioExportValidationError extends Error {
  constructor({ code, field, sourceListingId = null }) {
    super(code);
    this.name = 'EmporioExportValidationError';
    this.code = code;
    this.field = field;
    this.sourceListingId = sourceListingId;
  }
}

function safeValidationError(error, sourceListingId) {
  if (error instanceof EmporioExportValidationError) return error;
  const message = error instanceof Error ? error.message : '';
  const match = /^(missing|invalid|unsupported) ([a-z_]+)/.exec(message);
  const kind = match?.[1];
  return new EmporioExportValidationError({
    code: kind === 'missing' ? 'MISSING_REQUIRED_FIELD' : kind === 'unsupported' ? 'UNSUPPORTED_ENUM' : 'INVALID_FIELD',
    field: match?.[2] || 'listing',
    sourceListingId,
  });
}

function isoUtc(value, field, { required = false } = {}) {
  if (!value) {
    if (required) throw new Error(`missing ${field}`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${field}`);
  return date.toISOString();
}

function exportStatus(status) {
  // `published` is the only status represented by the public catalogue as
  // available.  Every other known/unknown internal state is exported as
  // inactive; this never claims a sale or transaction.
  return text(status)?.toLowerCase() === 'published' ? 'ACTIVE' : 'INACTIVE';
}

export function mapPropertyToEmporioListing(property) {
  const id = text(property?.id);
  const sourceListingId = id ? `inmoadmin:${id}` : null;
  try {
    if (!id) throw new Error('missing id');
    const city = text(property.ciudad);
    const state = text(property.estado);
    if (!city) throw new Error('missing ciudad');
    if (!state) throw new Error('missing estado');

    const publicId = text(property.public_id);
    const currency = (text(property.moneda) || 'MXN').toUpperCase();
    if (currency !== 'MXN') throw new Error(`unsupported moneda: ${String(property.moneda)}`);

    return {
      source_listing_id: sourceListingId,
      operation: normalizedEnum(property.operacion, operationMap, 'operacion'),
      status: exportStatus(property.status),
      property_type: normalizedEnum(property.tipo, propertyTypeMap, 'tipo', 'OTHER'),
      asking_price: finiteNumber(property.precio, 'precio', { required: true }),
      currency,
      state,
      // Inmoadmin currently has no municipality field in the audited schema.
      // City is copied to municipality until a dedicated normalized field exists.
      municipality: city,
      city,
      // `colonia` is the only audited zone-like field; it is deliberately not
      // promoted to a stronger geographic assertion.
      zone: text(property.colonia),
      // Exact address is optional and is exported only when Inmoadmin already
      // marks it as publishable.  Otherwise it is omitted, not approximated.
      address: property.mostrar_ubicacion_exacta === true ? text(property.direccion) : null,
      land_m2: finiteNumber(property.m2_terreno, 'm2_terreno'),
      built_m2: finiteNumber(property.m2_construccion, 'm2_construccion'),
      bedrooms: finiteNumber(property.recamaras, 'recamaras'),
      bathrooms: finiteNumber(property.banos, 'banos'),
      parking_spaces: finiteNumber(property.estacionamientos, 'estacionamientos'),
      // No authoritative published_at column was found in the audited schema.
      // created_at is preserved as a source-record timestamp, not a claim that
      // the listing was publicly published at that instant.
      published_at: isoUtc(property.created_at, 'created_at', { required: true }),
      updated_at: isoUtc(property.updated_at || property.created_at, 'updated_at', { required: true }),
      canonical_url: publicId ? `https://www.emporioinmobiliario.com.mx/propiedades/${encodeURIComponent(publicId)}` : null,
      title: text(property.titulo),
    };
  } catch (error) {
    throw safeValidationError(error, sourceListingId);
  }
}

export function buildEmporioIntelligenceExport(properties, {
  observedAt = new Date().toISOString(),
  authoritativeFullSnapshot = false,
} = {}) {
  if (!Array.isArray(properties)) throw new Error('properties must be an array');
  const seen = new Set();
  const listings = properties.map((property) => {
    const listing = mapPropertyToEmporioListing(property);
    if (seen.has(listing.source_listing_id)) throw new Error(`duplicate source_listing_id: ${listing.source_listing_id}`);
    seen.add(listing.source_listing_id);
    return listing;
  });

  const payload = {
    source_id: 'inmoadmin-emporio',
    authorized: true,
    authoritative_full_snapshot: authoritativeFullSnapshot === true,
    observed_at: isoUtc(observedAt, 'observed_at', { required: true }),
    listings,
  };
  validateEmporioIntelligenceExport(payload);
  return payload;
}

export function validateEmporioIntelligenceExport(payload) {
  if (!payload || payload.source_id !== 'inmoadmin-emporio' || payload.authorized !== true) {
    throw new Error('invalid export envelope');
  }
  if (typeof payload.authoritative_full_snapshot !== 'boolean') throw new Error('invalid authoritative_full_snapshot');
  isoUtc(payload.observed_at, 'observed_at', { required: true });
  if (!Array.isArray(payload.listings)) throw new Error('invalid listings');

  const ids = new Set();
  for (const listing of payload.listings) {
    if (!text(listing.source_listing_id) || ids.has(listing.source_listing_id)) throw new Error('invalid source_listing_id');
    ids.add(listing.source_listing_id);
    if (!['SALE', 'RENT'].includes(listing.operation)) throw new Error('invalid operation');
    if (!['ACTIVE', 'INACTIVE'].includes(listing.status)) throw new Error('invalid status');
    if (!['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'OFFICE', 'OTHER'].includes(listing.property_type)) throw new Error('invalid property_type');
    finiteNumber(listing.asking_price, 'asking_price', { required: true });
    if (listing.currency !== 'MXN') throw new Error('invalid currency');
    for (const required of ['state', 'municipality', 'city']) if (!text(listing[required])) throw new Error(`missing ${required}`);
    for (const optionalNumber of ['land_m2', 'built_m2', 'bedrooms', 'bathrooms', 'parking_spaces']) finiteNumber(listing[optionalNumber], optionalNumber);
    isoUtc(listing.published_at, 'published_at', { required: true });
    isoUtc(listing.updated_at, 'updated_at', { required: true });
  }
  return true;
}
