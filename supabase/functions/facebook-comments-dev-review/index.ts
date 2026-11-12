import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createFacebookDevReview} from '../../../lib/messaging/commentAgent/facebookDevReview.js';
import {facebookCommentDevNames} from '../../../lib/messaging/commentAgent/facebookDevConfig.js';
const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','FACEBOOK_COMMENTS_DEV_PAGE_ACCESS_TOKEN',...facebookCommentDevNames.map(n=>'FACEBOOK_COMMENTS_DEV_'+n)];
Deno.serve(createFacebookDevReview({env:()=>Object.fromEntries(names.map(n=>[n,Deno.env.get(n)])),makeDb:e=>createClient(e.SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}));
