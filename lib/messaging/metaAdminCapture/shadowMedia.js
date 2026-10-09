import {retrieveMetaAdminMedia} from './mediaTransport.js';
import {interpretOpenAIShadowMedia} from '../../shadow/media/openaiInterpretation.js';
import {sanitizeShadowText} from '../../shadow/coordinator.js';
import {createConversationMemoryEvidence} from './conversationMemorySupabase.js';

// Runs only within an already-started unique Shadow claim. Never on webhook.
export function createShadowMediaReader({db,env,now=Date.now,retrieve=retrieveMetaAdminMedia,interpret=interpretOpenAIShadowMedia}){
 return async ({inputId,token,messageType,identityState,authorizeInterpretation,onModelStart})=>{
  let media,modelCalls=0;
  const marker=messageType==='image'?'[IMAGEN]':'[DOCUMENTO]';
  try{
   if(identityState!=='matched')throw Error();
   const evidence=await createConversationMemoryEvidence(db,{now})(inputId);
   if(evidence.audience!=='external_verified')throw Error();
   const {data,error}=await db.rpc('meta_admin_shadow_media_claim_v1',{p_input_id:inputId,p_token:token});
   if(error||data?.input_id!==inputId)throw Error();
   media=await retrieve(data,{env});
   if(typeof authorizeInterpretation!=='function'||await authorizeInterpretation()!==true)throw Error();
   const result=await interpret(media,{env,beforeRequest:async()=>{
    if(modelCalls!==0)throw Error();
    const {data:won,error:startError}=await db.rpc('meta_admin_shadow_media_model_start_v1',{p_input_id:inputId,p_token:token});
    if(startError||won!==true)throw Error();
    modelCalls=1;onModelStart?.();
   }});
   if(modelCalls!==1)throw Error();
   const summary=sanitizeShadowText(result.summary);
   if(summary.rejected)throw Error();
   // No extracted financial fields enter canonical context. Always observed only.
   return {status:'complete',text:marker+' Contenido observado, no validado: '+summary.text+' No acredita pago conciliado ni autenticidad.',incomplete:true,model_calls:modelCalls};
  }catch{return {status:'failed',text:marker+' Contenido no disponible; solicitar aclaración. No inferir contenido.',incomplete:true,model_calls:modelCalls};}
  finally{media?.buffer?.fill(0);}
 };
}
