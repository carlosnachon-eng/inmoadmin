export default function CommentObservation({data,comment,onUse}){
 const row=data?.rows?.find(r=>r.platform==='instagram'&&r.comment_ref===comment);
 return <section aria-label="Observación de comentarios" style={{padding:12,background:'#f0f5ff',borderRadius:8,marginBottom:12}}>
  <strong>Observación DEV · sin publicaciones</strong>
  {!data?<p>Diagnóstico de propuestas no disponible.</p>:<>
   <p>Recibidos: {data.metrics.received} · Propuestas: {data.metrics.proposed} · Escalados: {data.metrics.escalated} · Respuestas del agente: 0</p>
   <p>Facebook: captura pendiente. Auditoría durable y aprobación del agente pendientes.</p>
   {row&&<><p>{row.status} · {row.reason}</p>{row.public_proposal&&<><p>{row.public_proposal}</p>
    <button type="button" onClick={()=>onUse(row.public_proposal)}>Copiar propuesta al borrador manual</button></>}</>}
  </>}
 </section>;
}
