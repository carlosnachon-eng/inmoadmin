import assert from 'node:assert/strict';
import test from 'node:test';
import {
  propertyIsCurrentlyAdministered,
  propertyWasAdministeredInPeriod,
  propertyWasAdministeredOn,
} from '../lib/administrationService.js';

test('preserves history through the administration end date', () => {
  const property = { administration_ended_at: '2026-08-31' };
  assert.equal(propertyWasAdministeredOn(property, '2026-08-31'), true);
  assert.equal(propertyWasAdministeredInPeriod(property, '2026-08'), true);
});

test('excludes cobranza and commissions after administration ends', () => {
  const property = { administration_ended_at: '2026-08-31' };
  assert.equal(propertyWasAdministeredOn(property, '2026-09-01'), false);
  assert.equal(propertyWasAdministeredInPeriod(property, '2026-09'), false);
  assert.equal(propertyIsCurrentlyAdministered(property), false);
});

test('keeps properties without an end date active', () => {
  assert.equal(propertyWasAdministeredInPeriod({}, '2030-01'), true);
});
