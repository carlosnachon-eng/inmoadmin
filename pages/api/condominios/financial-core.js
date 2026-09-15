import { createClient } from "@supabase/supabase-js";
import { FINANCIAL_EVIDENCE_BUCKET, financialErrorCode, financialEvidence, financialEvidencePath, validateFinancialAction } from "../../../lib/condominios/financialCore.mjs";

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reply = (res,status,code,extra={}) => res.status(status).json({ok:status>=200&&status<300,code,...extra});

async function clients(req, requireEdit = true) {
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();
  if(!token) return {error:"SESSION_REQUIRED",status:401};
  const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const serviceDb=createClient(url,serviceKey,opts);
  const {data,error}=await serviceDb.auth.getUser(token);
  if(error||!data?.user?.id) return {error:"INVALID_SESSION",status:401};
  const operatorDb=createClient(url,anonKey,{...opts,global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:profile,error:profileError}=await serviceDb.from("profiles").select("id,role_id,active,roles:role_id(es_externo)").eq("id",data.user.id).maybeSingle();
  if(profileError) return {error:"PERMISSION_CHECK_FAILED",status:503};
  if(!profile||profile.active===false||profile.roles?.es_externo===true) return {error:"OPERATION_NOT_ALLOWED",status:403};
  if(profile.role_id!=="admin"){
    const {data:permission,error:permissionError}=await serviceDb.from("permisos_modulo").select("puede_ver,puede_editar").eq("role_id",profile.role_id).eq("modulo","condominios").maybeSingle();
    if(permissionError) return {error:"PERMISSION_CHECK_FAILED",status:503};
    if(permission?.puede_ver!==true||(requireEdit&&permission?.puede_editar!==true)) return {error:"OPERATION_NOT_ALLOWED",status:403};
  }
  return {operatorDb,serviceDb,userId:data.user.id};
}

const maskReference = value => {
  const text=String(value||"").trim();
  if(!text) return null;
  return `••••${text.slice(-4)}`;
};

async function financialSnapshot(ctx,condominioId,evidenceReceiptId){
  if(!/^[0-9a-f-]{36}$/i.test(String(condominioId||""))) return {error:"INVALID_CONDOMINIUM",status:400};
  const {data:control,error:controlError}=await ctx.serviceDb.from("condominium_financial_controls").select("ledger_enabled").eq("condominio_id",condominioId).maybeSingle();
  if(controlError) return {error:"FINANCIAL_READ_FAILED",status:503};
  if(evidenceReceiptId){
    const {data:receipt,error}=await ctx.serviceDb.from("condominium_receipts").select("id,evidence_path").eq("id",evidenceReceiptId).eq("condominio_id",condominioId).maybeSingle();
    if(error||!receipt?.evidence_path) return {error:"EVIDENCE_NOT_FOUND",status:404};
    const {data,error:signError}=await ctx.serviceDb.storage.from(FINANCIAL_EVIDENCE_BUCKET).createSignedUrl(receipt.evidence_path,60);
    if(signError||!data?.signedUrl) return {error:"EVIDENCE_UNAVAILABLE",status:503};
    return {evidence:{signedUrl:data.signedUrl,expiresIn:60}};
  }
  if(control?.ledger_enabled!==true) return {snapshot:{ledgerEnabled:false}};
  const specs=[
    ["funds","condominium_funds","id,code,name,fund_type,currency,active,created_at"],
    ["bankAccounts","condominium_bank_accounts","id,code,display_name,institution_name,currency,active,opened_at,closed_at"],
    ["concepts","condominium_charge_concepts","id,fund_id,code,name,concept_type,active"],
    ["periods","condominium_financial_periods","id,period_code,starts_on,ends_on,status"],
    ["charges","condominium_charges","id,unidad_id,concept_id,fund_id,period_id,amount,due_date,description,status,created_at"],
    ["transactions","condominium_bank_transactions","id,bank_account_id,booked_on,value_on,direction,amount,bank_reference,description,status,identified_unidad_id,created_at"],
    ["receipts","condominium_receipts","id,unidad_id,received_on,amount,currency,payer_reference,evidence_path,status,created_at"],
    ["applications","condominium_payment_applications","id,receipt_id,charge_id,fund_id,amount,status,created_at"],
    ["matches","condominium_bank_matches","id,bank_transaction_id,receipt_id,amount,status,matched_at"],
    ["reconciliations","condominium_reconciliations","id,bank_account_id,period_id,statement_opening_balance,statement_closing_balance,ledger_closing_balance,difference,status,confirmed_at,created_at"],
    ["ledgerBalances","condominium_financial_ledger_balances","bank_account_id,fund_id,unidad_id,account_code,balance"],
    ["units","unidades_condominio","id,numero"],
  ];
  const results=await Promise.all(specs.map(async([key,table,select])=>{
    const query=ctx.serviceDb.from(table).select(select).eq("condominio_id",condominioId);
    const {data,error}=await query;
    return {key,data,error};
  }));
  if(results.some(result=>result.error)) return {error:"FINANCIAL_READ_FAILED",status:503};
  const snapshot={ledgerEnabled:true};
  results.forEach(({key,data})=>{snapshot[key]=data||[];});
  snapshot.transactions=snapshot.transactions.map(row=>({...row,bank_reference:maskReference(row.bank_reference)}));
  snapshot.receipts=snapshot.receipts.map(row=>({...row,payer_reference:maskReference(row.payer_reference),has_evidence:Boolean(row.evidence_path),evidence_path:undefined}));
  return {snapshot};
}

const RPC = Object.freeze({
  "create-charge":["condominium_financial_create_charge",b=>({p_id:b.id,p_condominio_id:b.condominioId,p_unidad_id:b.unidadId,p_concept_id:b.conceptId,p_period_id:b.periodId,p_amount:Number(b.amount),p_due_date:b.dueDate||null,p_description:b.description||null,p_idempotency_key:b.idempotencyKey})],
  "import-bank-transaction":["condominium_financial_import_bank_transaction",b=>({p_id:b.id,p_condominio_id:b.condominioId,p_bank_account_id:b.bankAccountId,p_booked_on:b.bookedOn,p_value_on:b.valueOn||null,p_direction:b.direction,p_amount:Number(b.amount),p_bank_reference:b.bankReference||null,p_description:b.description||null,p_source_hash:b.sourceHash,p_idempotency_key:b.idempotencyKey})],
  "identify-bank-transaction":["condominium_financial_identify_bank_transaction",b=>({p_transaction_id:b.transactionId,p_condominio_id:b.condominioId,p_unidad_id:b.unidadId})],
  "apply-receipt":["condominium_financial_apply_receipt",b=>({p_receipt_id:b.receiptId,p_condominio_id:b.condominioId,p_applications:(b.applications||[]).map(x=>({chargeId:x.chargeId,amount:Number(x.amount)}))})],
  "match-bank-receipt":["condominium_financial_match_bank_receipt",b=>({p_condominio_id:b.condominioId,p_transaction_id:b.transactionId,p_receipt_id:b.receiptId,p_amount:Number(b.amount),p_idempotency_key:b.idempotencyKey})],
  "confirm-receipt":["condominium_financial_confirm_receipt",b=>({p_condominio_id:b.condominioId,p_receipt_id:b.receiptId,p_period_id:b.periodId,p_idempotency_key:b.idempotencyKey})],
  "reverse-receipt":["condominium_financial_reverse_receipt",b=>({p_condominio_id:b.condominioId,p_receipt_id:b.receiptId,p_period_id:b.periodId,p_reason:b.reason,p_idempotency_key:b.idempotencyKey})],
});

export default async function handler(req,res){
  if(!["GET","POST"].includes(req.method)) return reply(res,405,"METHOD_NOT_ALLOWED");
  if(!url||!anonKey||!serviceKey) return reply(res,503,"SERVICE_UNAVAILABLE");
  const ctx=await clients(req,req.method==="POST"); if(ctx.error) return reply(res,ctx.status,ctx.error);
  if(req.method==="GET"){
    const result=await financialSnapshot(ctx,req.query.condominioId,req.query.evidenceReceiptId);
    if(result.error)return reply(res,result.status,result.error);
    return reply(res,200,"FINANCIAL_SNAPSHOT",result);
  }
  const action=String(req.body?.action||""); const invalid=validateFinancialAction(action,req.body); if(invalid) return reply(res,400,invalid);
  try{
    if(action==="create-receipt"){
      let evidencePath=null,evidenceSha256=null,uploaded=false;
      if(req.body.evidence){
        const evidence=financialEvidence(req.body.evidence); if(!evidence) return reply(res,400,"INVALID_EVIDENCE");
        evidencePath=financialEvidencePath({condominioId:req.body.condominioId,receiptId:req.body.id,extension:evidence.extension}); evidenceSha256=evidence.sha256;
        const upload=await ctx.serviceDb.storage.from(FINANCIAL_EVIDENCE_BUCKET).upload(evidencePath,evidence.bytes,{contentType:evidence.mimeType,upsert:false});
        if(upload.error) return reply(res,409,"EVIDENCE_CONFLICT"); uploaded=true;
      }
      const {data,error}=await ctx.operatorDb.rpc("condominium_financial_create_receipt",{p_id:req.body.id,p_condominio_id:req.body.condominioId,p_unidad_id:req.body.unidadId||null,p_received_on:req.body.receivedOn,p_amount:Number(req.body.amount),p_payer_reference:req.body.payerReference||null,p_evidence_path:evidencePath,p_evidence_sha256:evidenceSha256,p_idempotency_key:req.body.idempotencyKey});
      if(error){if(uploaded)await ctx.serviceDb.storage.from(FINANCIAL_EVIDENCE_BUCKET).remove([evidencePath]);return reply(res,409,financialErrorCode(error));}
      return reply(res,200,"RECEIPT_REGISTERED",{entity:data});
    }
    const [rpc,map]=RPC[action]; const {data,error}=await ctx.operatorDb.rpc(rpc,map(req.body));
    if(error)return reply(res,error.code==="42501"?403:409,financialErrorCode(error));
    return reply(res,200,"FINANCIAL_OPERATION_OK",{entity:data});
  }catch(error){console.error("condominium_financial_core_failed",{code:error?.code||"UNEXPECTED_ERROR"});return reply(res,500,"UNEXPECTED_ERROR");}
}
