import {shadowOnceGate} from './shadowOnce.js';
import {createCanonicalShadowContextReaders} from '../../shadow/canonicalReadOnlyContext.js';
export {prepareAdminShadowContext} from '../../shadow/canonicalReadOnlyContext.js';

// Internal adapter only: no caller/model-supplied entity IDs, no model invocation.
export function createAdminShadowContextReaders({db,snapshot,inputId,now=Date.now}) {
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(inputId||''))throw Error('invalid_input_id');
  return createCanonicalShadowContextReaders({db,now,readIdentity:async()=>{
    const s=await snapshot(inputId),g=shadowOnceGate(s,now());
    if(!g.allowed)return g;
    if(s.input.id!==inputId||s.identity.state!=='matched')return {allowed:false,reason:'matched_identity_required'};
    return {allowed:true,clientIdentityId:s.identity.client_identity_id,fingerprint:g.fingerprint};
  }});
}
