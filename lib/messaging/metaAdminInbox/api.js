export function createInboxHandler({authorize,reader}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  try{
   const actor=await authorize(req);
   if(!actor?.active||!['admin','coord_operaciones'].includes(actor.role_id))return res.status(403).json({error:'forbidden'});
   if(Object.keys(req.query||{}).some(k=>!['input_id','before'].includes(k))||
    Object.values(req.query||{}).some(v=>typeof v!=='string'))return res.status(400).json({error:'invalid_request'});
   const data=req.query?.input_id?await reader().detail(req.query.input_id):await reader().list(req.query?.before??null);
   return res.status(200).json({data});
  }catch{return res.status(503).json({error:'inbox_unavailable'});}
 };
}
