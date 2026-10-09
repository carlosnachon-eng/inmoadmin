import {createAdminShadowContextReaders,prepareAdminShadowContext} from './shadowContextReadOnly.js';
import {runMetaAdminShadowOnce} from './shadowOnce.js';

// Operator-only composition. DB capability stays server-side; model gets a DTO.
// No new caller, webhook, cron or sender is introduced.
export function runMetaAdminShadowOnceWithContext({db,inputId,authorizedInputId,store,env,now=Date.now,propose}){
  const readers=createAdminShadowContextReaders({db,snapshot:id=>store.snapshot(id),inputId,now});
  return runMetaAdminShadowOnce({inputId,authorizedInputId,store,env,now,propose,
    readContext:()=>{
      if(typeof db?.from!=='function')throw Error('context_reader_unavailable');
      return prepareAdminShadowContext({readers,sections:['agreement','charges']});
    }});
}
