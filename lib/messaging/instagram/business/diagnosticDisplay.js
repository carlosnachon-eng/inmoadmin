// Client-safe projection of server-sanitized metadata. Never render API values.
const fields=new Set(['data','access_token','user_id','permissions','token_type','expires_in','error','error_type','error_message','code','error_subcode','message','type','id','scopes','scope','status']);
const types=new Set(['object','array','null','undefined','string','number','boolean']);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const name=v=>fields.has(v)?v:'[redacted_field]';
const fieldTypes=v=>Array.isArray(v)?v.slice(0,32).filter(x=>record(x)&&types.has(x.type)).map(x=>({key:name(x.key),type:x.type})):[];
const keys=v=>Array.isArray(v)?v.slice(0,32).map(name):[];
export function projectOAuthShapeDiagnostic(d){
 if(!record(d)||d.stage!=='short_token_shape')return null;
 const s=d.short_token_response_shape;
 if(!record(s)||!types.has(s.root_type)||!types.has(s.data_type))return null;
 return {root_type:s.root_type,top_level_keys:keys(s.top_level_keys),top_level_types:fieldTypes(s.top_level_types),
  data_present:s.data_present===true,data_type:s.data_type,
  data_length:Number.isSafeInteger(s.data_length)&&s.data_length>=0?s.data_length:null,
  data_items:Array.isArray(s.data_items)?s.data_items.slice(0,3).filter(x=>record(x)&&types.has(x.type)).map(x=>({type:x.type,keys:keys(x.keys),field_types:fieldTypes(x.field_types)})):[]};
}
