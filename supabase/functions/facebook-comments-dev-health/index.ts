import {createFacebookDevHealth} from '../../../lib/messaging/commentAgent/facebookDevHealth.js';
const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','FACEBOOK_COMMENTS_DEV_APP_ID','FACEBOOK_COMMENTS_DEV_PAGE_ID','FACEBOOK_COMMENTS_DEV_CONNECTION_ID','FACEBOOK_COMMENTS_DEV_MANUAL_SEND_ENABLED','FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN','FACEBOOK_COMMENTS_DEV_APP_SECRET'];
Deno.serve(createFacebookDevHealth({env:()=>Object.fromEntries(names.map(n=>[n,Deno.env.get(n)]))}));
