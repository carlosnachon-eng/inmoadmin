import { normalizeMarketingKeyword } from './marketingKeyword.mjs';
import { inventoryTerms } from '../social/salesInventory.js';

export async function readExactPublicListing(db, filters, capability, generation, digest, signal) {
  const { data, error } = await db.rpc('respond_inventory_exact_listing', {
    p_capability: capability,
    p_generation: generation,
    p_token_sha256: digest ?? null,
    p_keyword: filters.keyword ? normalizeMarketingKeyword(filters.keyword) : null,
    p_reference: filters.reference ?? null,
    p_operation: filters.operation ?? null,
    p_city: filters.city ?? null,
    p_type: filters.propertyType ?? null,
    p_max_price: filters.maxPrice ?? null,
    p_currency: filters.currency ?? null,
    p_zone_terms: inventoryTerms(filters.zone),
  }).abortSignal(signal);
  if (error || data?.status !== 'ok' || !Array.isArray(data.listings) || data.listings.length > 2)
    throw new Error('source_unavailable');

  const listings = data.listings.map(row => ({
    publicId: row.public_id,
    publicUrl: row.public_id
      ? 'https://www.emporioinmobiliario.com.mx/propiedades/' + encodeURIComponent(row.public_id) : null,
    title: row.titulo, operation: row.operacion, price: row.precio, currency: row.moneda,
    propertyType: row.tipo, city: row.ciudad, bedrooms: row.recamaras, bathrooms: row.banos,
    listingStatus: row.status,
  }));
  return { listings, searchEvidence: { status: listings.length ? 'matched' : 'empty' } };
}
