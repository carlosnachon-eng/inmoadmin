// Fixed vocabulary only: never serialize an exception, SQL detail, or env value.
const configurationCodes=new Set(['business_environment_denied','business_configuration_incomplete','business_redirect_denied','environment_denied','configuration_incomplete']);
const databaseCodes=new Set(['42501','42883','42P01','42703','PGRST202','PGRST301','PGRST302','PGRST303']);
export function reviewDiagnostic(stage,error){
 const safeStage=['authorization','configuration','database_client','journal_read','projection','approval','evaluation'].includes(stage)?stage:'unknown';
 let code='unclassified';
 if(safeStage==='configuration'&&configurationCodes.has(error?.message))code=error.message;
 if(safeStage==='journal_read'&&databaseCodes.has(error?.code))code=error.code;
 return {stage:safeStage,code};
}
export function reviewDatabaseError(error){
 const safe=new Error('review_store_unavailable');
 if(databaseCodes.has(error?.code))safe.code=error.code;
 return safe;
}
