import {messengerConfig} from './config.js';
import {messengerStore} from './store.js';
import {provisionMessenger} from './provisioning.js';
import {sameOriginAdminRequest} from '../../../shadow/identityBootstrap.js';

export function createMessengerSetupApi({authorize,getDb,env=()=>process.env,fetchImpl}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    try {
      const variables=env(),c=messengerConfig(variables);
      if(!c)return res.status(404).end();
      if(req.method!=='POST')return res.status(405).end();
      const actor=await authorize(req);
      if(!actor?.active||actor.role_id!=='admin'||!sameOriginAdminRequest(req))return res.status(403).json({status:'forbidden'});
      if(!req.body||Object.keys(req.body).length!==1||!['provision','health'].includes(req.body.operation))return res.status(400).json({status:'request_denied'});
      // No tokens, Page IDs, ciphertext or sender controls accepted from UI.
      if(c.senderEnabled)return res.status(409).json({status:'sender_must_be_off'});
      const result=await provisionMessenger(c,{actor,store:messengerStore(await getDb(),c.connection,c),
        token:variables.FACEBOOK_MESSENGER_PROVISIONING_PAGE_TOKEN,health:req.body.operation==='health',fetchImpl});
      return res.status(result.ok?200:409).json(result);
    }catch{return res.status(503).json({status:'setup_unavailable'});}
  };
}
