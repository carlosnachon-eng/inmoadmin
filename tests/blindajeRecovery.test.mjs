import test from 'node:test'
import assert from 'node:assert/strict'
import { storedClaim, submissionClaim, recoverPayment, claimStorageKey } from '../lib/externalPaymentClient.mjs'
const claim = {token:'a'.repeat(43),claim_hash:'b'.repeat(64),expires_at:'2099-01-01',role:'inquilino'}
function storage(value) {
 const data=new Map(value?[[claimStorageKey('inquilino'),JSON.stringify(value)]]:[])
 return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data}
}
test('claim survives reload, projects only credentials and never asks for another token',async()=>{
 const s=storage({...claim,nombre:'must not propagate'}),ref={current:null}
 assert.deepEqual(storedClaim(ref,'inquilino',s),claim)
 const old=global.fetch;global.fetch=()=>{throw Error('must not fetch')}
 try{assert.deepEqual(await submissionClaim({current:null},'inquilino',s),claim)}finally{global.fetch=old}
})
test('expired or malformed stored claim is cleared and reference synchronized',()=>{
 for(const value of [{...claim,expires_at:'2000-01-01'},{...claim,role:'propietario'},{...claim,token:'bad'}]){
  const s=storage(value),ref={current:claim};assert.equal(storedClaim(ref,'inquilino',s),null);assert.equal(s.data.size,0);assert.equal(ref.current,null)
 }
})
test('new claim persisted before return, exactly four fields and role namespace',async()=>{
 const old=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({...claim,record_id:'not allowed',name:'not allowed'})})
 try{const s=storage(),ref={current:null};assert.deepEqual(await submissionClaim(ref,'inquilino',s),claim);assert.deepEqual(JSON.parse(s.data.get(claimStorageKey('inquilino'))),claim)}finally{global.fetch=old}
})
test('storage failure prevents obtaining an insert credential',async()=>{
 await assert.rejects(submissionClaim({current:null},'inquilino',{getItem(){throw Error('storage disabled')}}),/storage disabled/)
})
test('recovery sends credential only, 404 continues, 503/network blocks retry without clearing claim',async()=>{
 const old=global.fetch
 try{
  for(const status of [200,404,503]){
   global.fetch=async(path,options)=>{assert.deepEqual(JSON.parse(options.body),{token:claim.token,role:'inquilino'});return {ok:status===200,status,json:async()=>({folio:'BL-2026-000001',payment_token:'p'})}}
   if(status===503) await assert.rejects(recoverPayment({role:'inquilino',claim}))
   else assert.deepEqual(await recoverPayment({role:'inquilino',claim}),status===404?null:{folio:'BL-2026-000001',payment_token:'p'})
  }
  global.fetch=async(path,options)=>{assert.deepEqual(JSON.parse(options.body),{invitation_token:claim.token});return {ok:true,json:async()=>({folio:'same'})}}
  assert.deepEqual(await recoverPayment({role:'inquilino',invitationToken:claim.token}),{folio:'same'})
 }finally{global.fetch=old}
})
