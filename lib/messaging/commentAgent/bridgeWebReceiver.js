import {createBridgeReceiver} from './bridgeReceiver.js';
// Native Vercel Web Handler: bypass Node's req.body helper, not security checks.
// Preserve the original bytes; never stringify a parsed object to verify a signature.
export function createBridgeWebReceiver(options={}){
 const receive=createBridgeReceiver(options);
 return async request=>{
  const url=new URL(request.url),headers=Object.fromEntries(request.headers);
  const req={method:request.method,url:url.pathname+url.search,headers};
  const responseHeaders=new Headers();let status=200,result;
  const res={setHeader(k,v){responseHeaders.set(k,v);},status(n){status=n;return this;},json(value){result=value;return this;}};
  // Let the receiver own limits, fatal UTF-8 decoding, and signature validation.
  req[Symbol.asyncIterator]=async function*(){
   if(!request.body)return;
   const reader=request.body.getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;yield value;}}
   finally{await reader.cancel();reader.releaseLock();}
  };
  await receive(req,res);
  return Response.json(result,{status,headers:responseHeaders});
 };
}
