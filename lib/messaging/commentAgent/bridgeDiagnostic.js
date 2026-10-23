// Closed vocabulary: never expose upstream bodies, exception text, credentials or IDs.
const stages=new Set(['bridge_authorization','body_read','identity','role','configuration','request_once','evaluation','approval','association','journal_read','projection','bridge_transport']);
const codes=new Set(['parsed_body','body_size','body_encoding','bridge_environment','bridge_operation','bridge_authentication','bridge_expired','bridge_signature','configuration','identity','role','upstream','replay_or_gate_denied','bridge_oidc_missing','bridge_destination','bridge_response','bridge_remote_unavailable','bridge_read_denied']);
export function bridgeDiagnostic(stage,error){
 return {stage:stages.has(stage)?stage:'bridge_transport',code:codes.has(error?.message)?error.message:'bridge_read_denied'};
}
export function safeBridgeDiagnostic(value){
 return value&&stages.has(value.stage)&&codes.has(value.code)?{stage:value.stage,code:value.code}:null;
}
