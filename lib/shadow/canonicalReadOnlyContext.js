import {createHash} from 'node:crypto';
import {resolveConfirmedContactIdentity} from './identityBridge.js';
import {resolveApprovedCondominiumIdentity} from './condominiumIdentity.js';
import {shadowContextTools} from './context.js';
import {buildResolvedOperationalContext} from './ai/operationalContext.js';
import {buildShadowOperationalResolution} from './ai/operationalResolution.js';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ref=(kind,id)=>`${kind}_${hash([kind,id]).slice(0,16)}`;
const fail=(reason,state='insufficient_context')=>{throw {contextFailure:true,state,reason};};
const requireThat=(ok,reason,state)=>{if(!ok)fail(reason,state);};
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)
  &&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:null;
const today=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
const amount=x=>{
  const s=typeof x==='number'&&Number.isFinite(x)?String(x):typeof x==='string'?x:'';
  requireThat(/^\d{1,10}(\.\d{1,2})?$/.test(s),'amount_unavailable');
  const [whole,decimal='']=s.split('.');return `${whole}.${decimal.padEnd(2,'0')}`;
};
const activeProperty=x=>['activo','active','ocupada','disponible','mantenimiento'].includes(x?.status);
const current=(c,date)=>['activo','active'].includes(c.status)&&day(c.start_date)&&day(c.end_date)
  &&c.start_date<=date&&date<=c.end_date;
const CONTRACT='id,property_id,tenant_client_id,status,start_date,end_date';
const SOURCE='client_identity_id,source_type,source_id,role_kind,link_status,revoked_at,condominium_id,source_version';

// Shared internal capability: readIdentity is supplied by a trusted server adapter,
// never by request/model arguments. No model, sender, audit or generic SQL tool.
export function createCanonicalShadowContextReaders({db,readIdentity,now=Date.now}) {
  const rows=async(query,max=20)=>{
    const {data,error}=await query.limit(max+1);
    requireThat(!error&&Array.isArray(data),'source_read_failed');
    requireThat(data.length<=max,'source_limit_exceeded');return data;
  };
  const one=async query=>{const r=await rows(query,1);requireThat(r.length===1,'source_missing');return r[0];};
  async function gate(){
    const evidence=await readIdentity();
    requireThat(evidence?.allowed===true,evidence?.reason||'identity_unverified','blocked');
    requireThat(UUID.test(evidence.clientIdentityId||'')&&typeof evidence.fingerprint==='string','matched_identity_required');
    return {g:{fingerprint:evidence.fingerprint},id:evidence.clientIdentityId};
  }
  async function resolve(){
    const {g,id}=await gate(), date=today(now);
    const identity=await one(db.from('client_identities').select('id,status,revoked_at,phone_digest').eq('id',id));
    requireThat(identity.id===id&&identity.status==='active'&&!identity.revoked_at,'identity_inactive');
    const roles=await rows(db.from('client_identity_roles').select('client_identity_id,role_kind,status,revoked_at').eq('client_identity_id',id));
    requireThat(roles.length>0&&roles.every(r=>r.client_identity_id===id&&r.status==='active'&&!r.revoked_at
      &&['owner','tenant'].includes(r.role_kind)),'role_unverified');
    const links=await rows(db.from('client_source_links').select(SOURCE).eq('client_identity_id',id));
    requireThat(links.length>0,'relationship_missing');
    requireThat(links.every(l=>l.client_identity_id===id&&l.link_status==='confirmed'&&!l.revoked_at
      &&UUID.test(l.source_id||'')&&roles.some(r=>r.role_kind===l.role_kind)),'relationship_unverified');
    const properties=new Map(),units=new Map(),tenants=new Map();
    if(links.some(l=>l.source_type==='condominium_unit_owner')){
      const c=await resolveApprovedCondominiumIdentity(db,{client_identity_id:id});
      requireThat(c.resolved,c.reason||'unit_relationship_changed');
      for(const u of c.units)units.set(u.id,{id:u.id,condominio_id:u.condominiumId});
    }
    for(const l of links){
      if(l.source_type==='active_contract_tenant'&&l.role_kind==='tenant'){
        const c=await one(db.from('contracts').select(CONTRACT).eq('id',l.source_id).eq('tenant_client_id',id));
        requireThat(c.id===l.source_id&&c.tenant_client_id===id&&current(c,date)&&UUID.test(c.property_id||''),'contract_not_current');
        const p=await one(db.from('properties').select('id,status,owner_client_id').eq('id',c.property_id));
        requireThat(p.id===c.property_id&&activeProperty(p),'property_unverified');
        properties.set(p.id,p);tenants.set(c.id,c);
      }else if(l.source_type==='managed_property_owner'&&l.role_kind==='owner'){
        const p=await one(db.from('properties').select('id,status,owner_client_id').eq('id',l.source_id).eq('owner_client_id',id));
        requireThat(p.id===l.source_id&&p.owner_client_id===id&&activeProperty(p),'property_unverified');properties.set(p.id,p);
      }else if(l.source_type==='condominium_unit_owner'&&l.role_kind==='owner'){
        requireThat(units.has(l.source_id),'unit_relationship_changed');
      }else fail('unsupported_relationship');
    }
    requireThat(properties.size+units.size===1,'multiple_property_or_unit','ambiguous');
    const property=[...properties.values()][0],unit=[...units.values()][0];
    let contracts=[...tenants.values()];
    if(tenants.size){
      const all=await rows(db.from('contracts').select(CONTRACT).eq('tenant_client_id',id));
      requireThat(all.every(c=>c.tenant_client_id===id&&day(c.start_date)&&day(c.end_date)),'contract_dates_unverified');
      const live=all.filter(c=>current(c,date));
      requireThat(new Set(live.map(c=>c.property_id)).size<=1,'multiple_property_or_unit','ambiguous');
      requireThat(live.length<=1,'multiple_current_contracts','ambiguous');
      requireThat(live.length===contracts.length&&live.every(c=>tenants.has(c.id)),'relationship_unverified');
    }
    if(property&&property.owner_client_id===id&&links.some(l=>l.source_type==='managed_property_owner'&&l.source_id===property.id)){
      contracts=await rows(db.from('contracts').select(CONTRACT).eq('property_id',property.id));
      requireThat(contracts.every(c=>c.property_id===property.id),'contract_scope_mismatch');
      requireThat(contracts.every(c=>day(c.start_date)&&day(c.end_date)),'contract_dates_unverified');
      contracts=contracts.filter(c=>current(c,date));
    }
    requireThat(contracts.length<=1,'multiple_current_contracts','ambiguous');
    const contract=contracts[0]||null;
    const identityRows=[{entityType:'contact_identity',internalId:id,resolved:true,roles:roles.map(r=>r.role_kind)},
      ...(property?[{entityType:'property',internalId:property.id}]:[]),
      ...(contract?[{entityType:'contract',internalId:contract.id}]:[])];
    const toolResults=[{name:'resolve_contact_identity',ok:true,result:identityRows}];
    const operational=buildResolvedOperationalContext({toolResults});
    requireThat(operational.clientIdentityId===id&&(!property||operational.propertyId===property.id)
      &&(!contract||operational.contractId===contract.id),'operational_scope_mismatch');
    if(property){
      const found=await shadowContextTools.find_properties(db,property.id);
      requireThat(found.length===1&&found[0].internalId===property.id,'property_unverified');
      // Do not expose names/hrefs returned by the legacy tool.
    }
    const scopedRoles=[...new Set(links.map(l=>l.source_type==='condominium_unit_owner'?'condomino':l.role_kind))].sort();
    // No unmatched extra role silently broadens the relationship.
    requireThat(roles.every(r=>links.some(l=>l.role_kind===r.role_kind)),'role_without_relationship');
    const output={state:'ready',roles:scopedRoles,property_ref:property?ref('property',property.id):null,
      unit_ref:unit?ref('unit',unit.id):null,contract_ref:contract?ref('contract',contract.id):null};
    const proof=hash([g.fingerprint,date,identity,roles,links,property,unit,contract]);
    return {id,gateFingerprint:g.fingerprint,proof,output,date,property,unit,contract,toolResults};
  }
  async function agreement(scope){
    if(scope.unit)fail('condominium_fee_source_unverified');
    requireThat(scope.contract,'current_contract_missing');
    const contracts=await shadowContextTools.find_active_contracts(db,{contractId:scope.contract.id},
      {effectiveOn:scope.date,includeRent:true,propertyId:scope.property.id});
    requireThat(contracts.length===1&&contracts[0].internalId===scope.contract.id,'contract_scope_mismatch');
    const c=contracts[0];
    return {kind:'rent',status:c.status,start_date:c.startDate,end_date:c.endDate,monthly_amount:amount(c.monthlyRent),
      currency:'MXN',source:'contracts.monthly_rent',effective_basis:'current_contract_record'};
  }
  async function charges(scope){
    const month=scope.date.slice(0,7);
    if(scope.unit)fail('condominium_fee_source_unverified');
    requireThat(scope.contract,'current_contract_missing');
    const data=await shadowContextTools.get_payment_summary(db,{contractId:scope.contract.id},{period:month});
    requireThat(data.length>0,'charges_unavailable');
    requireThat(data.every(r=>r.contractId===scope.contract.id&&day(r.period)&&r.period.slice(0,7)===month
      &&r.period>=scope.contract.start_date&&r.period<=scope.contract.end_date),'charge_scope_mismatch');
    const items=data.map(r=>{
      requireThat(['pagado','pendiente','atrasado','en_revision'].includes(r.status),'charge_status_unverified');
      const due=r.period;
      requireThat(day(due),'charge_date_unverified');
      return {period:month,due_date:due,amount:amount(r.amount),currency:'MXN',status:r.status};
    }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const resolution=buildShadowOperationalResolution({decision:{intent:'pago_renta'},envelope:{sanitizedText:'',providerMetadata:{}},
      tools:[...scope.toolResults,{name:'get_payment_summary',ok:true,result:data}]});
    return {period:month,items,interpretation:'recorded_status_only',source:'payments',
      operational_status:resolution.case_status,requires_human:resolution.requires_human};
  }
  async function read(kind,args){
    if(args.length)return {state:'blocked',reason:'reader_arguments_forbidden'};
    try {
      const before=await resolve();
      const detail=kind==='agreement'?await agreement(before):kind==='charges'?await charges(before):null;
      const after=await resolve();
      requireThat(before.proof===after.proof,'context_changed');
      // Re-read financial facts as well; a changed amount/status is not returned.
      const check=kind==='agreement'?await agreement(after):kind==='charges'?await charges(after):null;
      requireThat(hash(detail)===hash(check),'context_changed');
      const final=await gate();requireThat(final.g.fingerprint===before.gateFingerprint,'identity_changed');
      return {...before.output,...(detail?{[kind]:detail}:{})};
    }catch(e){return e?.contextFailure?{state:e.state,reason:e.reason}:{state:'insufficient_context',
      reason:e?.message==='source_limit_exceeded'?'source_limit_exceeded':'source_read_failed'};}
  }
  return Object.freeze({readRelationships:(...args)=>read('relationships',args),
    readAgreement:(...args)=>read('agreement',args),readCharges:(...args)=>read('charges',args)});
}

// Optional internal entry for parity/future shared consumers. The established
// Respond wrapper remains untouched; audit:false prevents identity audit writes.
export function createRespondCanonicalContextReaders({db,respondContactId,now=Date.now}) {
  return createCanonicalShadowContextReaders({db,now,readIdentity:async()=>{
    const identity=await resolveConfirmedContactIdentity(db,respondContactId,{audit:false});
    return {allowed:identity.resolved===true,reason:identity.reason,clientIdentityId:identity.clientContextKey,
      fingerprint:hash(identity)};
  }});
}

// Local preparation only, deliberately not imported by the deployed runner/API.
// Does not claim, start or invoke a model. No generic tool dispatcher.
export async function prepareAdminShadowContext({readers,sections=[]}) {
  if(!Array.isArray(sections)||sections.some(s=>!['agreement','charges'].includes(s))||new Set(sections).size!==sections.length)
    return {state:'blocked',reason:'unsupported_section'};
  const relations=await readers.readRelationships();if(relations.state!=='ready')return relations;
  const result={...relations};
  for(const section of sections){
    const r=await (section==='agreement'?readers.readAgreement():readers.readCharges());
    if(r.state!=='ready')return r;
    if(r.property_ref!==relations.property_ref||r.unit_ref!==relations.unit_ref||r.contract_ref!==relations.contract_ref
      ||JSON.stringify(r.roles)!==JSON.stringify(relations.roles))return {state:'insufficient_context',reason:'context_changed'};
    result[section]=r[section];
  }
  // Do not combine facts that changed between the independent reader calls.
  for(const section of sections){
    const r=await (section==='agreement'?readers.readAgreement():readers.readCharges());
    if(r.state!=='ready'||hash(r[section])!==hash(result[section]))return {state:'insufficient_context',reason:'context_changed'};
  }
  const final=await readers.readRelationships();
  if(JSON.stringify(final)!==JSON.stringify(relations))return {state:'insufficient_context',reason:'context_changed'};
  return result;
}
