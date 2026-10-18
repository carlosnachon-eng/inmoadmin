// Server-only Instagram Login configuration. No fallback to legacy credentials.
export const PROVIDER='instagram_login_business';
export const MESSAGE_SCOPES=Object.freeze(['instagram_business_basic','instagram_business_manage_messages']);
export const COMMENT_SCOPES=Object.freeze(['instagram_business_basic','instagram_business_manage_comments']);
export const SCOPES=Object.freeze([...new Set([...MESSAGE_SCOPES,...COMMENT_SCOPES])]);
export const isRef=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const isNative=x=>typeof x==='string'&&/^[A-Za-z0-9_.:=-]{1,1024}$/.test(x);
export const isUuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
export function businessConfig(env){
 if(env.INSTAGRAM_BUSINESS_ENABLED!=='true')return null;
 const production=env.VERCEL_ENV==='production';
 if(production ? env.INSTAGRAM_BUSINESS_ENV!=='production'||env.INSTAGRAM_BUSINESS_ROLLOUT!=='closed_canary'
   ||env.NEXT_PUBLIC_SUPABASE_URL!=='https://bnzrnizrmonjxlktbhlp.supabase.co'
   : !['test','development','preview'].includes(env.APP_ENV)
   ||env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')throw Error('business_environment_denied');
 const c={provider:PROVIDER,connection:env.INSTAGRAM_BUSINESS_CONNECTION_ID,app:env.INSTAGRAM_BUSINESS_APP_ID,
  instagramApp:env.INSTAGRAM_BUSINESS_INSTAGRAM_APP_ID,account:env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  secret:env.INSTAGRAM_BUSINESS_INSTAGRAM_APP_SECRET,verify:env.INSTAGRAM_BUSINESS_VERIFY_TOKEN,
  indexKey:env.INSTAGRAM_BUSINESS_INDEX_KEY,dataKey:env.INSTAGRAM_BUSINESS_DATA_KEY,tokenKey:env.INSTAGRAM_BUSINESS_TOKEN_KEY,
  redirect:env.INSTAGRAM_BUSINESS_OAUTH_REDIRECT_URI,version:env.INSTAGRAM_BUSINESS_GRAPH_VERSION||'v26.0',
  production,senderEnabled:env.INSTAGRAM_BUSINESS_MANUAL_SEND_ENABLED==='true'};
 if(!isUuid(c.connection)||![c.app,c.instagramApp,c.account].every(x=>/^\d{1,32}$/.test(x||''))
  ||!['v26.0'].includes(c.version)||![c.secret,c.verify].every(x=>typeof x==='string'&&x.length>=32&&x.length<=256)
  ||![c.indexKey,c.dataKey,c.tokenKey].every(x=>/^[a-f0-9]{64}$/.test(x||''))
  ||new Set([c.secret,c.verify,c.indexKey,c.dataKey,c.tokenKey]).size!==5)throw Error('business_configuration_incomplete');
 const u=new URL(c.redirect);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('business_redirect_denied');
 if(production&&c.redirect!=='https://app.emporioinmobiliario.com.mx/operaciones/instagram-business-setup')throw Error('business_redirect_denied');
 return Object.freeze(c);
}
