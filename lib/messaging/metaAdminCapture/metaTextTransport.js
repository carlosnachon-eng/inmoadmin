// One HTTP attempt. No retries, redirects, logging or persistence of credentials.
export async function sendMetaTextOnce({phoneNumberId,to,text,replyTo,accessToken,fetchImpl=fetch,httpErrorProjection}) {
  try {
    const response=await fetchImpl(`https://graph.facebook.com/v26.0/${phoneNumberId}/messages`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',
        text:{preview_url:false,body:text},context:{message_id:replyTo}})
    });
    let data;
    try {data=await response.json();} catch {
      return {status:'uncertain',wamid:null,...(!response.ok&&httpErrorProjection?{http_error:httpErrorProjection(response.status,null)}:{})};
    }
    if(!response.ok) return {status:response.status>=400&&response.status<500&&Number.isInteger(data?.error?.code)?'failed':'uncertain',wamid:null,
      ...(httpErrorProjection?{http_error:httpErrorProjection(response.status,data)}:{})};
    const wamid=data?.messages?.length===1?data.messages[0].id:null;
    return typeof wamid==='string'&&/^wamid\.[A-Za-z0-9+/=_-]{1,500}$/.test(wamid)
      ?{status:'accepted',wamid}:{status:'uncertain',wamid:null};
  } catch {return {status:'uncertain',wamid:null};}
}
