import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from './fixtures/emporio-intelligence-properties.json' with { type: 'json' };
import { buildEmporioIntelligenceExport } from '../lib/emporioIntelligenceExport.mjs';
import {
  ExportDownloadError,
  canDownloadEmporioIntelligenceExport,
  exportErrorMessage,
  exportFilenameUtc,
  requestEmporioIntelligenceExport,
} from '../lib/emporioIntelligenceExportDownload.mjs';

const validJson = JSON.stringify(buildEmporioIntelligenceExport(fixture, {
  observedAt: '2026-09-08T23:56:00Z', authoritativeFullSnapshot: true,
}));
const response = (body, { status = 200, contentType = 'application/json; charset=utf-8' } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: () => contentType },
  text: async () => body,
});
const activeSession = async () => ({ data: { session: { access_token: 'test-token-never-logged' } } });

test('button is visible only to active Admin profiles', () => {
  assert.equal(canDownloadEmporioIntelligenceExport({ role_id: 'admin', active: true }), true);
  assert.equal(canDownloadEmporioIntelligenceExport({ role_id: 'admin', active: false }), false);
  assert.equal(canDownloadEmporioIntelligenceExport({ role_id: 'asesor', active: true }), false);
});

test('uses an UTC filename and sends the session only in the Authorization header', async () => {
  let request;
  const result = await requestEmporioIntelligenceExport({
    getSession: activeSession,
    fetchImpl: async (...args) => { request = args; return response(validJson); },
    now: new Date('2026-09-08T23:56:00.789Z'),
  });
  assert.equal(result.filename, 'emporio-intelligence-export-20260908T235600Z.json');
  assert.equal(result.rawJson, validJson);
  assert.equal(request[0], '/api/admin/emporio-intelligence-export');
  assert.deepEqual(request[1], { method: 'GET', headers: { Authorization: 'Bearer test-token-never-logged' } });
});

test('does not call the endpoint without a session', async () => {
  let called = false;
  await assert.rejects(
    requestEmporioIntelligenceExport({ getSession: async () => ({ data: { session: null } }), fetchImpl: async () => { called = true; } }),
    (error) => error instanceof ExportDownloadError && error.code === 'SESSION_REQUIRED',
  );
  assert.equal(called, false);
});

test('fails safely for authorization, network, and invalid response errors', async () => {
  for (const [fetchImpl, code] of [
    [async () => response('', { status: 401 }), 'UNAUTHORIZED'],
    [async () => response('', { status: 403 }), 'FORBIDDEN'],
    [async () => { throw new Error('offline'); }, 'NETWORK_ERROR'],
    [async () => response('{"not":"an export"}'), 'INVALID_RESPONSE'],
    [async () => response(validJson, { contentType: 'text/plain' }), 'INVALID_RESPONSE'],
  ]) {
    await assert.rejects(
      requestEmporioIntelligenceExport({ getSession: activeSession, fetchImpl }),
      (error) => error instanceof ExportDownloadError && error.code === code,
    );
  }
});

test('surfaces only a safe 422 diagnostic for an invalid production listing', async () => {
  let error;
  try {
    await requestEmporioIntelligenceExport({
      getSession: activeSession,
      fetchImpl: async () => response(JSON.stringify({
        code: 'UNSUPPORTED_ENUM', source_listing_id: 'inmoadmin:test-id', field: 'tipo', value: 'never expose this',
      }), { status: 422 }),
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ExportDownloadError);
  assert.equal(error.code, 'EXPORT_FAILED');
  assert.equal(error.status, 422);
  assert.equal(error.safeCode, 'UNSUPPORTED_ENUM');
  assert.equal(error.sourceListingId, 'inmoadmin:test-id');
  assert.equal(error.field, 'tipo');
  assert.equal(error.message.includes('never expose this'), false);
  assert.equal(exportErrorMessage(error), 'HTTP 422 · Código: UNSUPPORTED_ENUM · Listing: inmoadmin:test-id · Campo: tipo. No se pudo validar el export. No se descargó ningún archivo.');
});

test('the helper has no token logging path', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../lib/emporioIntelligenceExportDownload.mjs', import.meta.url), 'utf8');
  assert.equal(/console\.(log|info|warn|error)/.test(source), false);
  assert.equal(exportFilenameUtc(new Date('2026-09-08T00:00:00Z')), 'emporio-intelligence-export-20260908T000000Z.json');
});
