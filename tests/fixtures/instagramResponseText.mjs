// Adapt synthetic object fixtures to the real response.text() contract.
// Precision-specific tests supply literal JSON instead, never JSON.stringify IDs.
export const withResponseText=(fn,args)=>fn({...args,fetchImpl:async(...request)=>{
 const r=await args.fetchImpl(...request);
 return {...r,text:r.text||async function(){return JSON.stringify(await r.json());}};
}});
