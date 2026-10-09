import {memoryHash} from './conversationMemory.js';
// Dedicated connection required (not a pool.query facade). Local/offline adapter.
// Only these two new memory tables can be written. Source journals are read elsewhere.
export function createConversationMemoryPostgres(client){
  return {
    async read(subject){
      const r=await client.query(`select e.id,e.subject,e.identity_fingerprint as "identityFingerprint",e.scope,e.family,e.topic,
        r.version,r.status,r.pending,r.commitment,r.contradiction,r.source_refs as "sourceRefs"
        from meta_admin_memory_private.episodes e join lateral (
          select * from meta_admin_memory_private.revisions where episode_id=e.id order by version desc limit 1
        ) r on true where e.subject=$1 order by e.id limit 101`,[subject]);
      if(r.rows.length>100)throw Error('episode_limit');return r.rows;
    },
    async append({episode:e,expectedVersion,sourceRef}){
      if(e.version!==expectedVersion+1)throw Error('memory_version_invalid');
      await client.query('begin');
      try{
        // Serialize same-subject creation as well as revisions; never a time-based episode key.
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[e.subject]);
        const roots=await client.query('select * from meta_admin_memory_private.episodes where id=$1',[e.id]);
        const root=roots.rows[0];
        if(root&&(root.subject!==e.subject||root.identity_fingerprint!==e.identityFingerprint
          ||root.family!==e.family||root.topic!==e.topic||memoryHash(Object.entries(root.scope).sort())!==memoryHash(Object.entries(e.scope).sort())))
          throw Error('memory_scope_immutable');
        const rows=await client.query('select * from meta_admin_memory_private.revisions where episode_id=$1 order by version desc',[e.id]);
        const prior=rows.rows.find(r=>r.source_ref===sourceRef);
        if(prior){
          if(prior.status!==e.status||prior.pending!==e.pending||prior.commitment!==e.commitment
            ||prior.contradiction!==e.contradiction||memoryHash(prior.source_refs)!==memoryHash(e.sourceRefs))throw Error('memory_replay_conflict');
          await client.query('commit');return {status:'duplicate',version:prior.version};
        }
        const last=rows.rows[0];
        if((last?.version||0)!==expectedVersion||last?.status==='resolved')throw Error('memory_stale');
        if(last&&(last.source_refs.some(r=>!e.sourceRefs.includes(r))||last.contradiction&&!e.contradiction))throw Error('memory_evidence_loss');
        if(!root)await client.query(`insert into meta_admin_memory_private.episodes
          (id,subject,identity_fingerprint,scope,family,topic) values($1,$2,$3,$4,$5,$6)`,[e.id,e.subject,e.identityFingerprint,e.scope,e.family,e.topic]);
        await client.query(`insert into meta_admin_memory_private.revisions
          (episode_id,version,source_ref,status,pending,commitment,contradiction,source_refs)
          values($1,$2,$3,$4,$5,$6,$7,$8)`,[e.id,e.version,sourceRef,e.status,e.pending,e.commitment,e.contradiction,JSON.stringify(e.sourceRefs)]);
        await client.query('commit');return {status:'appended',version:e.version};
      }catch(error){await client.query('rollback');throw error;}
    }
  };
}
