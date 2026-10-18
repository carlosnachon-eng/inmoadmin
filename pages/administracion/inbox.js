import Head from 'next/head';
import Layout from '../../components/Layout';
import InstagramBusinessInbox from '../../components/InstagramBusinessInbox';

export async function getServerSideProps(){
 return {props:{businessAvailable:process.env.INSTAGRAM_BUSINESS_ENABLED==='true'}};
}

export default function AdminInbox({businessAvailable=false}){
 return <Layout view="inbox">
  <Head><title>Inbox · Emporio Inmobiliario</title></Head>
  {businessAvailable
   ? <InstagramBusinessInbox/>
   : <main style={{padding:32}}><h1>Inbox</h1><p>Instagram Business todavía no está habilitado en este entorno.</p></main>}
 </Layout>;
}
