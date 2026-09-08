import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from './fixtures/emporio-intelligence-properties.json' with { type: 'json' };
import {
  PROPERTY_EXPORT_COLUMNS,
  buildEmporioIntelligenceExport,
  mapPropertyToEmporioListing,
  validateEmporioIntelligenceExport,
} from '../lib/emporioIntelligenceExport.mjs';

test('only the reviewed inventory projection is eligible for the export', () => {
  assert.deepEqual(PROPERTY_EXPORT_COLUMNS, [
    'id', 'public_id', 'titulo', 'operacion', 'precio', 'moneda', 'tipo',
    'recamaras', 'banos', 'estacionamientos', 'm2_construccion', 'm2_terreno',
    'direccion', 'colonia', 'ciudad', 'estado', 'mostrar_ubicacion_exacta',
    'status', 'created_at', 'updated_at',
  ]);
  assert.equal(PROPERTY_EXPORT_COLUMNS.includes('notas_internas'), false);
  assert.equal(PROPERTY_EXPORT_COLUMNS.includes('agente_id'), false);
  assert.equal(PROPERTY_EXPORT_COLUMNS.includes('telefono'), false);
});

test('maps a full authorized snapshot without PII or inferred transaction', () => {
  const payload = buildEmporioIntelligenceExport(fixture, {
    observedAt: '2026-09-08T15:00:00Z',
    authoritativeFullSnapshot: true,
  });
  assert.equal(payload.authoritative_full_snapshot, true);
  assert.equal(payload.listings.length, 2);
  assert.deepEqual(payload.listings[0], {
    source_listing_id: 'inmoadmin:cb14b6c2-603d-49aa-b671-57f640c543ad',
    operation: 'SALE', status: 'ACTIVE', property_type: 'HOUSE', asking_price: 3100000,
    currency: 'MXN', state: 'Puebla', municipality: 'Puebla', city: 'Puebla', zone: 'La Paz',
    address: null, land_m2: 120, built_m2: 180, bedrooms: 3, bathrooms: 2.5, parking_spaces: 2,
    published_at: '2026-09-08T12:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z',
    canonical_url: 'https://www.emporioinmobiliario.com.mx/propiedades/EMP-PUE-001',
    title: 'Casa de prueba en La Paz',
  });
  assert.equal(payload.listings[1].status, 'INACTIVE');
  assert.equal(payload.listings[1].operation, 'RENT');
  assert.equal('confirmed_transaction' in payload.listings[1], false);
  assert.equal('direccion' in payload.listings[0], false);
  assert.equal(validateEmporioIntelligenceExport(payload), true);
});

test('exports exact address only when it is already public', () => {
  const listing = mapPropertyToEmporioListing({ ...fixture[0], mostrar_ubicacion_exacta: true });
  assert.equal(listing.address, 'Calle de prueba 100');
});

test('maps every audited property lifecycle value without inferring a transaction', () => {
  const expected = {
    published: 'ACTIVE',
    reserved: 'INACTIVE',
    apartada: 'INACTIVE',
    sold: 'INACTIVE',
    leased: 'INACTIVE',
    draft: 'INACTIVE',
    archived: 'INACTIVE',
    null: 'INACTIVE',
  };
  for (const [status, exportStatus] of Object.entries(expected)) {
    const property = { ...fixture[0], status: status === 'null' ? null : status };
    assert.equal(mapPropertyToEmporioListing(property).status, exportStatus, status);
  }
});

test('fails closed on ambiguous inventory values', () => {
  assert.throws(() => mapPropertyToEmporioListing({ ...fixture[0], operacion: 'swap' }), /unsupported operacion/);
  assert.throws(() => mapPropertyToEmporioListing({ ...fixture[0], precio: null }), /missing precio/);
  assert.throws(() => buildEmporioIntelligenceExport([fixture[0], fixture[0]]), /duplicate source_listing_id/);
});
