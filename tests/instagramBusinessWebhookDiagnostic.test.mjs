import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createBusinessWebhook} from '../lib/messaging/instagram/business/api.js';
const env={VERCEL_ENV:'production',INSTAGRAM_BUSINESS_ENV:'production',INSTAGRAM_BUSINESS_ROLLOUT:'closed_canary',NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co',INSTAGRAM_BUSINESS_ENABLED:'true',INSTAGRAM_BUSINESS_CONNECTION_ID:'00000000-0000-4000-8000-000000000001',INSTAGRAM_BUSINESS_APP_ID:'100',INSTAGRAM_BUSINESS_INSTAGRAM_APP_ID:'200',INSTAGRAM_BUSINESS_ACCOUNT_ID:'300',INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET:'a'.repeat(32),INSTAGRAM_BUSINESS_VERIFY_TOKEN:'b'.repeat(32),INSTAGRAM_BUSINESS_INDEX_KEY:'c'.repeat(64),INSTAGRAM_BUSINESS_DATA_KEY:'d'.repeat(64),INSTAGRAM_BUSINESS_TOKEN_KEY:'e'.repeat(64),INSTAGRAM_BUSINESS_OAUTH_REDIRECT_URI:'https://app.emporioinmobiliario.com.mx/operaciones/instagram-business-setup'};
const body=()=>({object:'instagram',entry:[{id:'300',messaging:[{sender:{id:'400'},recipient:{id:'300'},timestamp:1700000000000,message:{mid:'fixture.mid',text:'PRIVATE_CONTENT'}}]}]});
async function invoke(options={}){
 const raw=Buffer.from(options.raw??JSON.stringify(options.body??body())),records=[];
 const signature=options.badSignature?'sha256='+'0'.repeat(64):'sha256='+createHmac('sha256',env.INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET).update(raw).digest('hex');
 const req={method:options.method??'POST',query:{},headers:{'content-type':options.contentType??'application/json','x-hub-signature-256':signature},async *[Symbol.asyncIterator](){if(options.streamError)throw Error('PRIVATE_STREAM_ERROR');yield raw;}};
 const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;return this;},send(){return this;},end(){return this;}};
 await createBusinessWebhook({env:()=>({...env,...options.env}),getDb:async()=>{if(options.dbError)throw Error('PRIVATE_DATABASE_ERROR');return{rpc:async()=>options.rpcError?{error:{message:'PRIVATE_RPC_ERROR'}}:{data:options.ack??{durable:true,inserted:1,duplicates:0}}};},diagnostic:r=>{records.push(r);if(options.loggerError)throw Error('logger failed');}})(req,res);
 // Only a closed schema is permitted, with no event or exception values.
 for(const r of records)assert.deepEqual(Object.keys(r).sort(),['hmac_valid','http_status','rejection_stage']);
 assert.doesNotMatch(JSON.stringify(records),/PRIVATE|fixture|sha256|400|access_token/);
 return{res,records};
}
const cases=[
 ['configuration',{env:{INSTAGRAM_BUSINESS_TOKEN_KEY:''}},503,null,'configuration'],
 ['content type',{contentType:'text/plain'},415,null,'content_type'],
 ['stream',{streamError:true},503,null,'raw_body'],
 ['body limit',{raw:'x'.repeat(262145)},413,null,'body_size'],
 ['database client',{dbError:true},503,null,'database_client'],
 ['invalid HMAC',{badSignature:true},401,false,'signature'],
 ['valid HMAC invalid JSON',{raw:'{'},503,true,'json'],
 ['valid HMAC wrong envelope',{body:{field:'messages',value:{}}},503,true,'envelope'],
 ['wrong account',{body:{object:'instagram',entry:[{id:'999'}]}},503,true,'account_allowlist'],
 ['wrong account checked before malformed messaging',{body:{object:'instagram',entry:[{id:'999',messaging:{}}]}},503,true,'account_allowlist'],
 ['authorized account malformed messaging',{body:{object:'instagram',entry:[{id:'300',messaging:{}}]}},503,true,'messaging_structure'],
 ['authorized account null messaging',{body:{object:'instagram',entry:[{id:'300',messaging:null}]}},503,true,'messaging_structure'],
 ['authorized account absent messaging remains accepted',{body:{object:'instagram',entry:[{id:'300'}]},ack:{durable:true,inserted:0,duplicates:0}},200,true,null],
 ['wrong event',{body:{object:'instagram',entry:[{id:'300',messaging:[{message:{mid:'fixture.mid'}}]}]}},503,true,'event_shape'],
 ['RPC failure',{rpcError:true},503,true,'persistence'],
 ['non-durable acknowledgement',{ack:{durable:false}},503,true,'durable_ack'],
 ['success',{},200,true,null],
 ['logger cannot affect acknowledgement',{loggerError:true},200,true,null]
];
for(const [label,options,status,hmac,stage] of cases)test('sanitized webhook diagnostic: '+label,async()=>{const {res,records}=await invoke(options);assert.equal(res.code,status);assert.deepEqual(records,[{hmac_valid:hmac,rejection_stage:stage,http_status:status}]);});
test('challenge never emits diagnostic',async()=>{const {res,records}=await invoke({method:'GET'});assert.equal(res.code,403);assert.deepEqual(records,[]);});
test('concurrent requests cannot share HMAC state',async()=>{const [a,b]=await Promise.all([invoke(),invoke({badSignature:true})]);assert.equal(a.records[0].hmac_valid,true);assert.equal(b.records[0].hmac_valid,false);});
