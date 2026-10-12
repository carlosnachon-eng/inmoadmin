import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInstagramThread as project, sameInstagramHistoryScope as same,
  planCommentDmLink, instagramActionGate, INSTAGRAM_CAPABILITIES} from '../lib/messaging/instagram/threadBoundary.js';
const base = {nativeVerified:true, accountId:'synthetic-account', subjectId:'synthetic-user',
  eventId:'synthetic-event', messageId:'synthetic-message', threadType:'instagram_dm', provenance:'customer_inbound'};
const comment = {...base, threadType:'instagram_comment', mediaId:'synthetic-post',
  commentId:'synthetic-comment', rootCommentId:'synthetic-comment', rootRelationVerified:true};
test('DM and public comment from same user never share history', () => assert.equal(same(project(base),project(comment)),false));
test('account scope prevents cross-account history', () => assert.equal(same(project(base),project({...base,accountId:'other'})),false));
test('different DM subjects stay separate', () => assert.equal(same(project(base),project({...base,subjectId:'other'})),false));
test('different public roots stay separate', () => assert.equal(same(project(comment),project({...comment,rootCommentId:'other'})),false));
test('exact reply root preserves public thread but retains its source', () => {
  const a=project(comment),b=project({...comment,eventId:'reply-event',commentId:'reply',subjectId:'other'});
  assert.equal(same(a,b),true); assert.notEqual(a.sourceRef,b.sourceRef);
});
test('unresolved parent/root fails closed', () => assert.throws(()=>project({...comment,rootRelationVerified:false}),/relation_unknown/));
test('duplicate native delivery is stable', () => assert.deepEqual(project(base),project({...base})));
test('different native events remain distinct', () => assert.notEqual(project(base).deliveryRef,project({...base,eventId:'other'}).deliveryRef));
test('echo does not establish human authorship', () => {
  assert.equal(project({...base,provenance:'business_outbound_unattributed'}).provenance,'business_outbound_unattributed');
  assert.throws(()=>project({...base,provenance:'human_confirmed'}),/human_unproven/);
});
test('system outbound needs exact journal evidence', () => assert.throws(()=>project({...base,provenance:'system_outbound_confirmed'}),/system_unproven/));
test('projection exposes no native IDs or payload content', () => {
  const text=JSON.stringify(project({...base,text:'private-text',username:'private-name',token:'secret-value'}));
  assert.doesNotMatch(text,/synthetic|private-text|private-name|secret-value/);
});
test('matched identity supplied in event never grants private context', () => {
  const e=project({...comment,clientIdentityId:'injected',identityState:'matched'});
  assert.equal(e.clientIdentityId,null); assert.equal(e.privateContextAllowed,false);
});
test('handoff without native linkage is blocked', () => assert.throws(()=>planCommentDmLink(project(comment),project(base),{}),/unproven/));
test('exact handoff does not merge, grant sending, private access or resume', () => {
  const c=project(comment),d=project(base);
  const link=planCommentDmLink(c,d,{verified:true,commentSourceRef:c.sourceRef,dmSourceRef:d.sourceRef});
  for(const k of ['mergeHistory','grantPrivateContext','grantSend','resumeAi'])assert.equal(link[k],false);
});
test('handoff cannot cross subjects', () => {
  const c=project(comment),d=project({...base,subjectId:'other'});
  assert.throws(()=>planCommentDmLink(c,d,{verified:true,commentSourceRef:c.sourceRef,dmSourceRef:d.sourceRef}),/unproven/);
});
test('all effects disabled, no sender or model can be granted', () => {
  assert.ok(Object.values(INSTAGRAM_CAPABILITIES).every(v=>v===false));
  assert.equal(instagramActionGate({matched:true,enabled:true}).allowed,false);
});
test('unverified source rejected', () => assert.throws(()=>project({...base,nativeVerified:false}),/evidence_missing/));
test('unknown provenance rejected', () => assert.throws(()=>project({...base,provenance:'unknown'}),/provenance_unknown/));
