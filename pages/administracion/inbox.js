import Head from 'next/head';
import Layout from '../../components/Layout';
import InstagramBusinessInbox from '../../components/InstagramBusinessInbox';
import CommercialInbox from '../../components/CommercialInbox';
import {messengerEnvironmentAllowed} from '../../lib/messaging/facebook/messenger/config';

export async function getServerSideProps(){
 const enabled=process.env.INSTAGRAM_BUSINESS_ENABLED==='true'
  &&(process.env.VERCEL_ENV!=='production'||process.env.INSTAGRAM_BUSINESS_ROLLOUT==='closed_canary');
 const messengerAvailable=process.env.FACEBOOK_MESSENGER_ENABLED==='true'&&messengerEnvironmentAllowed(process.env);
 return {props:{businessAvailable:enabled,messengerAvailable}};
}

export default function AdminInbox({businessAvailable=false,messengerAvailable=false}){
 return <Layout view="inbox">
  <Head><title>Inbox · Emporio Inmobiliario</title></Head>
  {messengerAvailable?<CommercialInbox instagramAvailable={businessAvailable}/>:businessAvailable
   ?<InstagramBusinessInbox/>
   :<main style={{padding:32}}><h1>Inbox</h1><p>Instagram Business todavía no está habilitado en este entorno.</p></main>}
 </Layout>;
}
