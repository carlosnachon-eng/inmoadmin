// Final model boundary: reconstruct the certified DTO, never spread DB rows.
const check=(value)=>{if(!value)throw Error('invalid_shadow_context_projection');};
const money=x=>typeof x==='string'&&/^\d{1,10}\.\d{2}$/.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const ref=(value,kind)=>{check(value===null||typeof value==='string'&&new RegExp(`^${kind}_[a-f0-9]{16}$`).test(value));return value;};
export function projectAdminShadowContext(value){
  check(value&&['ready','ambiguous','insufficient_context','blocked'].includes(value.state));
  if(value.state!=='ready')return {state:value.state,
    reason:value.reason==='condominium_fee_source_unverified'?'condominium_fee_source_unverified':
      value.state==='ambiguous'?'clarification_required':'context_unavailable'};
  check(Array.isArray(value.roles)&&value.roles.length>0&&value.roles.length<=3&&value.roles.every(r=>['owner','tenant','condomino'].includes(r)));
  const out={state:'ready',roles:[...new Set(value.roles)].sort(),property_ref:ref(value.property_ref,'property'),
    unit_ref:ref(value.unit_ref,'unit'),contract_ref:ref(value.contract_ref,'contract')};
  check(Boolean(out.property_ref)!==Boolean(out.unit_ref));
  // Monetary condominium data is intentionally not accredited in v1.
  if(out.unit_ref){check(!value.agreement&&!value.charges);return out;}
  if(value.agreement){
    const a=value.agreement;
    check(out.contract_ref&&a.kind==='rent'&&['activo','active'].includes(a.status)&&day(a.start_date)&&day(a.end_date)
      &&a.start_date<=a.end_date&&money(a.monthly_amount)&&a.currency==='MXN'&&a.source==='contracts.monthly_rent');
    out.agreement={kind:'rent',status:a.status,start_date:a.start_date,end_date:a.end_date,monthly_amount:a.monthly_amount,currency:'MXN',source:'contracts.monthly_rent'};
  }
  if(value.charges){
    const c=value.charges;
    check(out.contract_ref&&/^\d{4}-(0[1-9]|1[0-2])$/.test(c.period||'')&&c.source==='payments'
      &&Array.isArray(c.items)&&c.items.length>0&&c.items.length<=50);
    out.charges={period:c.period,source:'payments',interpretation:'recorded_status_only',items:c.items.map(i=>{
      check(i.period===c.period&&day(i.due_date)&&i.due_date.slice(0,7)===c.period&&money(i.amount)
        &&i.currency==='MXN'&&['pagado','pendiente','atrasado','en_revision'].includes(i.status));
      return {period:c.period,due_date:i.due_date,amount:i.amount,currency:'MXN',status:i.status};
    })};
  }
  return out;
}
