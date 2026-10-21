import {messengerConfig} from '../facebook/messenger/config.js';

// Adapt the existing validated cipher contract, never read Messenger credentials.
export const facebookCommentDevNames = Object.freeze([
 'ENABLED','CONNECTION_ID','APP_ID','PAGE_ID','APP_SECRET','VERIFY_TOKEN',
 'INDEX_KEY','DATA_KEY','TOKEN_KEY','MANUAL_SEND_ENABLED',
]);
export function facebookCommentDevConfig(env){
 if(env.VERCEL_ENV!=='development'
  ||env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')throw Error('environment_denied');
 if(env.FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED!=='false')throw Error('sender_not_closed');
 return messengerConfig({
  APP_ENV:'development',VERCEL_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL,
  ...Object.fromEntries(facebookCommentDevNames.map(n=>['FACEBOOK_MESSENGER_'+n,env['FACEBOOK_COMMENTS_DEV_'+n]])),
 });
}
