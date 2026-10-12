import { createHash } from 'node:crypto';

// Internal adapter boundary only. NOT a raw webhook parser, identity bridge,
// database journal, sender or authorization capability. No production callers.
const digest = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_:=-]{1,512}$/.test(value);
const fail = reason => { throw new Error(reason); };
export const INSTAGRAM_THREAD_TYPES = Object.freeze(['instagram_dm', 'instagram_comment']);
export const INSTAGRAM_CAPABILITIES = Object.freeze({
  receive: false, sendDm: false, replyPublic: false, privateReply: false,
  hide: false, delete: false, model: false,
});

// `evidence` must eventually come from a signature-verified server adapter and
// exact Graph/native relations. Neither UI nor an LLM may supply this object.
// Public comments are rooted by exact media + root comment, NOT author alone.
export function projectInstagramThread(evidence) {
  const e = evidence;
  if (!e || e.nativeVerified !== true || !id(e.accountId) || !id(e.subjectId)
    || !id(e.eventId) || !INSTAGRAM_THREAD_TYPES.includes(e.threadType)) fail('instagram_evidence_missing');
  if (!['customer_inbound', 'business_outbound_unattributed', 'human_confirmed',
    'system_outbound_confirmed'].includes(e.provenance)) fail('instagram_provenance_unknown');
  if (e.provenance === 'human_confirmed' && !id(e.authenticatedOperatorJournalId)) fail('instagram_human_unproven');
  if (e.provenance === 'system_outbound_confirmed' && !id(e.outboundJournalId)) fail('instagram_system_unproven');
  const publicThread = e.threadType === 'instagram_comment';
  if (publicThread && (!id(e.mediaId) || !id(e.commentId) || !id(e.rootCommentId)
    || e.rootRelationVerified !== true)) fail('instagram_comment_relation_unknown');
  if (!publicThread && !id(e.messageId)) fail('instagram_message_missing');
  const threadRef = 'ig_thread_' + digest(publicThread
    ? [e.accountId, e.threadType, e.mediaId, e.rootCommentId]
    : [e.accountId, e.threadType, e.subjectId]);
  return Object.freeze({
    threadType: e.threadType, threadRef,
    subjectRef: 'ig_subject_' + digest([e.accountId, e.subjectId]),
    accountRef: 'ig_account_' + digest([e.accountId]),
    visibility: publicThread ? 'public' : 'private',
    provenance: e.provenance,
    mediaRef: publicThread ? 'ig_media_' + digest([e.accountId, e.mediaId]) : null,
    // One native delivery key. A durable receiver must preserve later revisions
    // separately; content/timestamp equality is never deduplication evidence.
    deliveryRef: 'ig_delivery_' + digest([e.accountId, e.threadType, e.eventId]),
    sourceRef: 'ig_source_' + digest([e.accountId, e.threadType, publicThread ? e.commentId : e.messageId]),
    clientIdentityId: null,
    privateContextAllowed: false,
    effectsEnabled: false,
  });
}

export function sameInstagramHistoryScope(a, b) {
  return !!a && !!b && a.threadRef === b.threadRef && a.accountRef === b.accountRef
    && a.threadType === b.threadType && a.visibility === b.visibility;
}

// Explicit reference only: never merges histories, lifts human pause or opens
// the DM service window. A later sender needs its own policy/claim authorization.
export function planCommentDmLink(comment, dm, exactNativeLink) {
  if (comment?.threadType !== 'instagram_comment' || dm?.threadType !== 'instagram_dm'
    || comment.accountRef !== dm.accountRef || comment.subjectRef !== dm.subjectRef
    || exactNativeLink?.verified !== true || exactNativeLink.commentSourceRef !== comment.sourceRef
    || exactNativeLink.dmSourceRef !== dm.sourceRef) fail('instagram_handoff_unproven');
  return Object.freeze({fromThread: comment.threadRef, toThread: dm.threadRef,
    mergeHistory: false, grantPrivateContext: false, grantSend: false, resumeAi: false});
}

// Until durable Instagram-scoped attention/claims and audited account permissions
// exist, this integration cannot grant any action, even to a matched identity.
export function instagramActionGate() {
  return { allowed: false, reason: 'instagram_integration_disconnected' };
}
