import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cierreVigente,motivoCancelacionValido,cancellationError,devolucionParcialValida} from '../lib/cierreCancellation.js';
test('active totals exclude cancelled historical values',()=>{
 const rows=[{id:943,estado:'cancelado',comision:22000,pendiente:22000},{id:950,estado:'activo',comision:10000,pendiente:10000}];
 assert.deepEqual(rows.filter(cierreVigente).map(c=>c.id),[950]);
 assert.equal(rows.filter(cierreVigente).reduce((s,c)=>s+c.comision,0),10000);
});
test('reason and controlled errors',()=>{
 for(const x of ['',null,'corto',' '.repeat(30),'a'.repeat(1001)])assert.equal(motivoCancelacionValido(x),false);
 assert.equal(motivoCancelacionValido('Operación cancelada por prueba DEV'),true);
 assert.ok(!cancellationError({message:'sensitive detail'}).includes('sensitive'));
});
test('audited financial consumers explicitly filter active closures',()=>{
 for(const file of ['pages/index.js','pages/ejecutivo.js','pages/ejecutivo/gerencia-ventas.js','pages/ejecutivo/conciliacion-cierres.js','pages/api/ejecutivo/bi-cierres-admin.js','pages/api/ejecutivo/conciliacion-cierres.js','pages/api/ejecutivo/work-center.js','pages/api/ejecutivo/centro-inteligencia.js','pages/api/reporte-semanal.js','pages/api/cierres/recibo-comision.js']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const queries=[...source.matchAll(/\.from\(['"]cierres['"]\)\s*\.select\(['"][^'"]*['"]\)([^;\n]*)/g)];
  assert.ok(queries.length,file);
  for(const q of queries)assert.ok(q[1].includes(".eq('estado', 'activo')"),file);
 }
});
test('receipt sync sees cancellation, history excludes cancelled from active state',()=>{
 const ui=readFileSync(new URL('../pages/cierres.js',import.meta.url),'utf8');
 assert.match(ui,/setCierres\(\(cierresData \|\| \[\]\)\.filter\(cierreVigente\)\)/);
 assert.match(ui,/CierreCancellationDialog/);assert.match(ui,/Cancelar cierre/);
 const dialog=readFileSync(new URL('../components/CierreCancellationDialog.js',import.meta.url),'utf8');
 assert.match(dialog,/type="checkbox"/);assert.match(dialog,/confirmed && motivoCancelacionValido/);
 assert.match(readFileSync(new URL('../pages/api/recibos/sincronizar-abono-cierre.js',import.meta.url),'utf8'),/cierre.estado === 'cancelado'/);
});

test('partial refund requires exact money, real date and external reference',()=>{
 const valid={importe:5000,monto:4000,fecha:'2026-09-04',referencia:'Transferencia QA comprobante 4000'};
 assert.equal(devolucionParcialValida(valid,'2026-10-21'),true);
 for(const monto of [0,-1,5000,6000,4000.001,NaN,Infinity])assert.equal(devolucionParcialValida({...valid,monto},'2026-10-21'),false);
 for(const fecha of ['','2026-02-30','2026-10-22'])assert.equal(devolucionParcialValida({...valid,fecha},'2026-10-21'),false);
 assert.equal(devolucionParcialValida({...valid,referencia:'short'},'2026-10-21'),false);
});
