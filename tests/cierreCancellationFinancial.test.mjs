import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the real handlers/helpers with an in-memory query client and no network.
function load(file, dependencies = {}) {
  let source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const names = [...source.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(m => m[1]);
  if (source.includes('export default async function handler')) names.push('handler');
  source = source.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '').replace(/export default /g, '').replace(/export /g, '');
  const context = vm.createContext({ ...dependencies });
  vm.runInContext(source + '\nthis.result = {' + names.join(',') + '};', context, { filename: file });
  return context.result;
}
const catalog = load('lib/ejecutivo/catalogo.js');
const bi = load('lib/ejecutivo/lecturaBiCierresAdmin.js', catalog);
const date = new Date().toISOString().slice(0, 7) + '-10';
const rows = [
  {id:-251943,estado:'cancelado',fecha_cierre:date,vendedor:'ivan',comision:22000,cobrado:0,pendiente:22000},
  {id:-251950,estado:'activo',fecha_cierre:date,vendedor:'ivan',comision:10000,cobrado:100,pendiente:9900},
  {id:-251959,estado:'activo',fecha_cierre:'2025-01-01',vendedor:'ivan',comision:5000,cobrado:250,pendiente:4750},
];
const payments = [
  {id:'cancelled-movement',cierre_id:-251943,monto:700,fecha:date},
  {id:'active-movement',cierre_id:-251950,monto:100,fecha:date},
  {id:'prior-close-current-payment',cierre_id:-251959,monto:250,fecha:date},
];
const retentions=[], refunds=[];
function client() {
  return {auth:{getUser:async()=>({data:{user:{id:'fixture-admin',email:'qa@example.invalid'}}})},from(table){
    let conditions=[],selection='';
    const value=(row,key)=>key.startsWith('cierres.')?rows.find(c=>c.id===row.cierre_id)?.[key.slice(8)]:row[key];
    const q={select(s){selection=s;return q;},eq(key,v){conditions.push(r=>String(value(r,key))===String(v));return q;},
      gt(key,v){conditions.push(r=>Number(value(r,key))>v);return q;},gte(key,v){conditions.push(r=>value(r,key)>=v);return q;},lt(key,v){conditions.push(r=>value(r,key)<v);return q;},
      lte(key,v){conditions.push(r=>value(r,key)<=v);return q;},in(key,v){conditions.push(r=>v.includes(value(r,key)));return q;},order(){return q;},
      maybeSingle(){return q.then(r=>({...r,data:r.data[0]||null}));},then(resolve,reject){
        const data=table==='cierres'?rows:table==='cierre_pagos'?payments:table==='v_cierre_devoluciones'?refunds:table==='v_cierre_ingresos_cancelacion'?retentions:table==='profiles'?[{id:'fixture-admin',role_id:'admin',email:'qa@example.invalid'}]:[];
        if(selection.includes('cierres!inner'))assert.equal(table,'cierre_pagos');
        return Promise.resolve({data:data.filter(r=>conditions.every(f=>f(r))),error:null}).then(resolve,reject);
      }};return q;
  }};
}
function response(){return {code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};}
const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',CRON_SECRET:'synthetic',RESEND_API_KEY:'synthetic'};

test('BI excludes cancelled closures and their movements but keeps current collections of older active closures',async()=>{
  const {handler}=load('pages/api/ejecutivo/bi-cierres-admin.js',{...bi,createClient:client,process:{env}});
  const res=response();
  await handler({method:'GET',headers:{authorization:'Bearer synthetic'},query:{year:date.slice(0,4),month:date.slice(5,7),include:'events'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.metricas.ingreso_generado,10000);
  assert.equal(res.body.metricas.cobrado,350);
  assert.equal(res.body.metricas.pendiente_reconstruido,9900);
  assert.ok(!JSON.stringify(res.body.eventos).includes('cancelled-movement'));
  assert.ok(JSON.stringify(res.body.eventos).includes('prior-close-current-payment'));
});
test('weekly report excludes cancelled sales without sending any email',async()=>{
  let captured;
  const {handler}=load('pages/api/reporte-semanal.js',{createClient:client,process:{env},fetch:async(url,options)=>{captured=JSON.parse(options.body);return {ok:true};}});
  const res=response();await handler({headers:{authorization:'Bearer synthetic'}},res);
  assert.equal(res.code,200);assert.equal(res.body.totalCierres,1);assert.equal(res.body.totalIngresos,10000);
  assert.match(captured.html,/1 cierres/);assert.ok(!captured.html.includes('$22,000'));
});
test('commission receipt endpoint refuses a cancelled closure before generating a document',async()=>{
  let generated=false;
  const {handler}=load('pages/api/cierres/recibo-comision.js',{createClient:client,process:{env},generarReciboComisionPdf:()=>{generated=true;throw new Error('unexpected_pdf');}});
  const res=response();await handler({method:'GET',headers:{authorization:'Bearer synthetic'},query:{id:'-251943'}},res);
  assert.equal(res.code,404);assert.equal(generated,false);
});

test('retained cancellation income survives BI without counting as an active sale or adviser commission', async () => {
  rows.push({ id: -252500, estado: 'cancelado', cancelacion_ingreso_retenido: 25500, fecha_cierre: date, comision: 25500, cobrado: 25500, com_vendedor: 5100 });
  payments.push({ id: 'retained-original', cierre_id: -252500, monto: 25500, fecha: date });
  const base = client();
  const retainedClient = () => ({ ...base, from(table) {
    if (table === 'v_cierre_ingresos_cancelacion') {
      const q = { select() { return q; }, gte() { return q; }, lt() { return q; }, then(resolve) { return Promise.resolve({ data: [{ cierre_id: -252500, monto: 25500, fecha: date, recibo_id: 'receipt-retained' }], error: null }).then(resolve); } }; return q;
    }
    return base.from(table);
  } });
  try {
    const { handler } = load('pages/api/ejecutivo/bi-cierres-admin.js', { ...bi, createClient: retainedClient, process: { env } });
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer synthetic' }, query: { year: date.slice(0, 4), month: date.slice(5, 7), include: 'events' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.metricas.ingreso_generado, 35500);
    assert.equal(res.body.metricas.cobrado, 25850);
    assert.equal(res.body.metricas.pendiente_reconstruido, 9900);
    const events = res.body.eventos.cierres;
    assert.equal(events.filter(e => e.event_id === 'cierre_pago:retained-original:cobro_recibido').length, 1);
    assert.equal(events.filter(e => e.event_id === 'cancelacion:-252500:ingreso_generado').length, 1);
    assert.ok(!events.some(e => e.event_id === 'cierre:-252500:ingreso_generado'));
    assert.equal(events.find(e => e.event_id === 'cancelacion:-252500:ingreso_generado').metadata.comision_asesor_vigente, 0);
  } finally { rows.pop(); payments.pop(); }
});

test('retention recognition and historic cash belong to independent periods', () => {
  const recognized = bi.resumirCierres({ ingresosCancelacion: [{ cierre_id: -1, monto: 25500 }], cobrosCancelacion: [] });
  assert.equal(recognized.metricas.ingreso_generado, 25500);
  assert.equal(recognized.metricas.cobrado, 0);
  assert.equal(recognized.metricas.pendiente_reconstruido, 0);
  const historicCash = bi.resumirCierres({ ingresosCancelacion: [], cobrosCancelacion: [{ cierre_id: -1, monto: 25500 }] });
  assert.equal(historicCash.metricas.ingreso_generado, 0);
  assert.equal(historicCash.metricas.cobrado, 25500);
});


test('partial refund preserves 5000 gross cash, records 4000 outflow and reports 1000 net without a commercial sale', async()=>{
 const id=-252600;
 rows.push({id,estado:'cancelado',cancelacion_ingreso_retenido:1000,cancelacion_devolucion:4000,fecha_cierre:date,comision:5000,cobrado:5000,com_vendedor:1000});
 payments.push({id:'original-5000',cierre_id:id,monto:5000,fecha:date});
 retentions.push({cierre_id:id,monto:1000,fecha:date});
 refunds.push({cierre_id:id,monto:4000,fecha:date,referencia:'QA transferencia externa realizada'});
 try {
  const {handler}=load('pages/api/ejecutivo/bi-cierres-admin.js',{...bi,createClient:client,process:{env}});
  const res=response();await handler({method:'GET',headers:{authorization:'Bearer synthetic'},query:{year:date.slice(0,4),month:date.slice(5,7),include:'events'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.metricas.ingreso_generado,11000);
  assert.equal(res.body.metricas.cobrado,1350);
  assert.equal(res.body.metricas.pendiente_reconstruido,9900);
  const events=res.body.eventos.cierres.filter(e=>e.source_id===id||e.metadata.cierre_id===id);
  assert.equal(events.length,3);
  assert.equal(events.find(e=>e.event_type==='ingreso_generado').amount,1000);
  assert.equal(events.find(e=>e.event_type==='cobro_recibido').amount,5000);
  const refund=events.find(e=>e.event_type==='devolucion_registrada');
  assert.equal(refund.amount,4000);assert.equal(refund.direction,'salida');
  assert.equal(res.body.unidades.cierres.conciliacion.devuelto_periodo,4000);
 } finally {rows.pop();payments.pop();retentions.pop();refunds.pop();}
});

test('refund cash follows its real date, including a refund-only period with negative cash',()=>{
 const received=bi.resumirCierres({cobrosCancelacion:[{monto:5000}]});
 const returned=bi.resumirCierres({devolucionesCancelacion:[{monto:4000}]});
 const recognized=bi.resumirCierres({ingresosCancelacion:[{monto:1000}]});
 assert.equal(received.metricas.cobrado,5000);
 assert.equal(returned.metricas.cobrado,-4000);
 assert.equal(returned.metricas.ingreso_generado,0);
 assert.equal(recognized.metricas.ingreso_generado,1000);
 assert.equal(received.metricas.cobrado+returned.metricas.cobrado,1000);
});
