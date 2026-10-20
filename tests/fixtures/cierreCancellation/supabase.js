
const actor='00000000-0000-4000-8000-000000000251';
const params=()=>new URLSearchParams(typeof window==='undefined'?'':window.location.search);
const profile=()=>({id:actor,full_name:'Administración sintética',email:'qa@example.invalid',role_id:params().get('role')==='advisor'?'asesor':'admin',active:params().get('role')!=='inactive',roles:{es_externo:false}});
let rows=[
 {id:-251943,estado:'activo',propiedad:'DEV · Operación sintética sin movimientos',vendedor:'Ivan',anio:2026,mes:10,fecha_cierre:'2026-10-20',operacion:'VENTA',comision:22000,cobrado:0,pendiente:22000,com_vendedor:4400,pend_vend:4400,comision_inmobiliaria:17600},
 {id:-251950,estado:'activo',propiedad:'DEV · Control con cobro registrado',vendedor:'Carlos',anio:2026,mes:10,fecha_cierre:'2026-10-20',operacion:'RENTA',comision:10000,cobrado:100,pendiente:9900,com_vendedor:2000,pend_vend:2000,comision_inmobiliaria:8000},
 {id:-251952,estado:'cancelado',propiedad:'DEV · Historial sintético',vendedor:'Ivan',anio:2026,mes:10,fecha_cierre:'2026-10-19',operacion:'VENTA',comision:5000,cancelacion_motivo:'Cancelación histórica de prueba sintética',cancelado_por:actor,cancelado_en:'2026-10-20T18:00:00Z'}
];
export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},from(table){
 let filters=[]; const q={select(){return q},order(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},maybeSingle(){return q.then(r=>({...r,data:r.data?.[0]||null}))},then(resolve,reject){
  let data=table==='profiles'?[profile()]:table==='permisos_modulo'?[{role_id:'asesor',modulo:'cierres',puede_ver:true,puede_editar:false,alcance:'todos'}]:table==='cierres'?rows:[];
  return Promise.resolve({data:data.filter(r=>filters.every(f=>f(r))),error:params().get('scenario')==='load-error'&&table==='cierres'?{message:'synthetic_load_error'}:null}).then(resolve,reject);
 }};return q;
},async rpc(name,{p_cierre_id,p_motivo}){
 if(name!=='cancelar_cierre')throw new Error('fixture_rpc_not_allowed');
 if(profile().role_id!=='admin'||!profile().active)return {error:{message:'solo_admin'}};
 const row=rows.find(r=>r.id===p_cierre_id);
 if(params().get('scenario')==='rpc-error')return {error:{message:'synthetic_private_error'}};
 if(row.cobrado)return {error:{message:'cobros_requieren_conciliacion'}};
 if(row.estado==='cancelado')return {data:{status:'ya_cancelado'}};
 row.estado='cancelado';row.cancelacion_motivo=p_motivo;row.cancelado_en=new Date().toISOString();row.cancelado_por=actor;
 return {data:{status:'cancelado',id:row.id}};
}};
