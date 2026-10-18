// Server-only. Consume JSON text once; never stringify a previously rounded ID.
// Native JSON reviver source (Node 24) preserves the original numeric lexeme.
export function parseJsonWithLosslessUserId(text){
 try{
  if(typeof text!=='string')throw Error();
  const body=JSON.parse(text,function(key,value,context){
   if(key==='user_id'&&typeof value==='number'){
    if(typeof context?.source!=='string'||! /^[1-9][0-9]{0,31}$/.test(context.source))throw Error();
    return context.source;
   }
   return value;
  });
  // JSON.parse accepts duplicate keys. Reject ambiguous root fields, including
  // escaped spellings. JSON syntax was already validated above; strings are
  // consumed as whole tokens, so embedded keys cannot affect this check.
  const tokens=text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)||[];
  let depth=0,wantKey=false;const seen=new Set();
  for(const token of tokens){
   if(token==='{'||token==='['){depth++;if(depth===1&&token==='{')wantKey=true;continue;}
   if(token==='}'||token===']'){depth--;continue;}
   if(depth!==1)continue;
   if(token===','){wantKey=true;continue;}
   if(wantKey&&token.startsWith('"')){
    const key=JSON.parse(token);if(seen.has(key))throw Error();seen.add(key);wantKey=false;
   }
  }
  return body;
 }catch{throw Error('oauth_response_json_invalid');}
}
