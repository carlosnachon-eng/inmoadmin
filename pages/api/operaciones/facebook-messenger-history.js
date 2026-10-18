import {createClient} from '@supabase/supabase-js';
import {authorizeInboxStaff} from '../../../lib/shadow/ai/apiAuth.js';
import {sameOriginAdminRequest} from '../../../lib/shadow/identityBootstrap.js';
import {messengerConfig} from '../../../lib/messaging/facebook/messenger/config.js';
import {messengerStore} from '../../../lib/messaging/facebook/messenger/store.js';
import {importMessengerHistory} from '../../../lib/messaging/facebook/messenger/historyImport.js';

export const config={api:{bodyParser:{sizeLimit:'512b'}}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Referrer-Policy','no-referrer');
 if(req.method!=='POST')return res.status(405).end();
 try{
  if(!sameOriginAdminRequest(req))return res.status(403).json({status:'forbidden'});
  const actor=await authorizeInboxStaff(req);
  if(!actor?.active||actor.role_id!=='admin')return res.status(403).json({status:'forbidden'});
  if(!req.body||Object.keys(req.body).length!==0)return res.status(400).end();
  const c=messengerConfig(process.env);if(!c)return res.status(404).end();
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const result=await importMessengerHistory({config:c,actor,store:messengerStore(db,c.connection,c),db});
  return res.status(200).json(result);
 }catch{return res.status(503).json({status:'history_unavailable',notice:'Meta o el historial no están disponibles. No se enviaron mensajes.'});}
}
