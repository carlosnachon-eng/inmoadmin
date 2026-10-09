import {createAdminShadowContextReaders,prepareAdminShadowContext} from './shadowContextReadOnly.js';
import {runMetaAdminShadowOnce} from './shadowOnce.js';
import {createEvidenceBackedConversationReader} from './conversationMemorySupabase.js';
import {createShadowMediaReader} from './shadowMedia.js';

// Operator-only composition. DB capability stays server-side; model gets a DTO.
// No new caller, webhook, cron or sender is introduced.
export function runMetaAdminShadowOnceWithContext({db,inputId,authorizedInputId,store,env,now=Date.now,propose,readMedia}){
  const readers=createAdminShadowContextReaders({db,snapshot:id=>store.snapshot(id),inputId,now});
  const readContext=()=>{
      if(typeof db?.from!=='function')throw Error('context_reader_unavailable');
      return prepareAdminShadowContext({readers,sections:['agreement','charges']});
    };
  const readConversation=createEvidenceBackedConversationReader({db,inputId,now,
    readSnapshot:id=>store.snapshot(id),readCanonical:readContext});
  return runMetaAdminShadowOnce({inputId,authorizedInputId,store,env,now,propose,readContext,readConversation,
    readMedia:readMedia||createShadowMediaReader({db,env,now})});
}
