import test from 'node:test';
import assert from 'node:assert/strict';
import {publicInventoryTitle} from '../lib/respond/inventoryPilot.mjs';
for(const [title,price,currency] of [
 ['Casa en venta | $3,350,000',3350000,'MXN'],['Casa MXN 3,350,000.25',3350000.25,'MXN'],
 ['Casa US$125,000',125000,'USD'],['Casa $125,000 USD',125000,'USD'],['Casa $22,000',22000,'MXN'],
 ['Casa sin precio en título',3350000,'MXN'],
])test('public monetary title: '+title,()=>assert.equal(publicInventoryTitle(title,price,currency),title));
for(const title of ['Casa 2221234567','Casa +52 (222) 123-4567','Casa $3,350,000 llama 2221234567',
 'Casa Tel $3,350,000','Casa $3,350,000 | ID 1234567','Casa RFC ABCD900101XYZ',
 'Casa 12345678-abcd-1234-abcd-123456789abc','Casa $3,350,001','Casa USD 3,350,000',
 'Casa $3.350.000','Casa $3,350,000 y $3,350,000','Casa $3,350,000 correo@ejemplo.test',
 'Casa $3,350,000 https://example.test','Casa $3,350,000 <script>', 'Casa 1234567 $3,350,000',
 'Casa MXN 3,350,000 USD', 'Casa $3,350,000\nprivado', 'Casa $3350000', 'Casa ABCD900101HPLRRS09'])
 test('reject ambiguous/private title: '+JSON.stringify(title),()=>assert.throws(()=>publicInventoryTitle(title,3350000,'MXN'),/source_data_invalid/));
