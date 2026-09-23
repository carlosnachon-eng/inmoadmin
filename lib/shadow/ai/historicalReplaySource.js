import { createHash } from "node:crypto";
import { assertHistoricalReplayIsolation, HISTORICAL_REPLAY_DOMAINS, selectHistoricalReplayCohort } from "./historicalReplay.js";

// A bounded recent universe, not a global message tail. An oversized conversation
// is excluded entirely: a truncated history must never look like a complete turn.
export const HISTORICAL_REPLAY_SOURCE_LIMITS = Object.freeze({
  recentDays: 14, conversations: 24, messagesPerConversation: 2000,
  interpretationsPerConversation: 500, pageSize: 250, mediaBatchSize: 100,
  previewMaxAgeMs: 15 * 60 * 1000,
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, status = 409) => Object.assign(new Error(code), { replaySourceStatus: status });

async function boundedRows(query, limit) {
  const rows = [];
  while (rows.length <= limit) {
    const size = Math.min(HISTORICAL_REPLAY_SOURCE_LIMITS.pageSize, limit + 1 - rows.length);
    const { data, error } = await query().range(rows.length, rows.length + size - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    // Do not mistake a server-side row cap smaller than pageSize for EOF.
    if (!page.length) return { rows, exceeded: false };
  }
  return { rows: [], exceeded: true };
}

export async function loadHistoricalReplaySource(admin, { asOf } = {}) {
  const limits = HISTORICAL_REPLAY_SOURCE_LIMITS;
  const cutoff = new Date(asOf).toISOString();
  const occurredSince = new Date(Date.parse(cutoff) - limits.recentDays * 86400000).toISOString();
  const { data, error } = await admin.from("shadow_conversations")
    .select("id,provider,channel,respond_contact_id,last_message_at")
    .eq("provider", "respond_admin").eq("channel", "544519")
    .gte("last_message_at", occurredSince).lte("last_message_at", cutoff)
    .order("last_message_at", { ascending: false }).order("id", { ascending: true }).limit(limits.conversations + 1);
  if (error) throw error;
  const recent = (data || []).slice(0, limits.conversations);
  const loaded = await Promise.all(recent.map(async (conversation) => {
    const messages = await boundedRows(() => admin.from("shadow_messages")
      .select("id,conversation_id,external_message_id,direction,occurred_at,sanitized_text,message_type,attachment_metadata,provider_metadata")
      .eq("conversation_id", conversation.id).lte("occurred_at", cutoff).lte("created_at", cutoff)
      .order("occurred_at", { ascending: true }).order("id", { ascending: true }), limits.messagesPerConversation);
    if (messages.exceeded) return { excluded: "context_read_limit" };
    const externalIds = [...new Set(messages.rows.filter((row) => Array.isArray(row.attachment_metadata) && row.attachment_metadata.length)
      .map((row) => row.external_message_id).filter(Boolean))];
    const interpretations = [];
    for (let offset = 0; offset < externalIds.length; offset += limits.mediaBatchSize) {
      const batch = externalIds.slice(offset, offset + limits.mediaBatchSize);
      const media = await boundedRows(() => admin.from("shadow_media_interpretations")
        .select("id,external_message_id,status,result_safe,interpreted_at")
        .eq("provider", "respond_admin").eq("status", "completed").in("external_message_id", batch)
        .lte("interpreted_at", cutoff).order("interpreted_at", { ascending: true }).order("id", { ascending: true }),
      limits.interpretationsPerConversation - interpretations.length);
      if (media.exceeded) return { excluded: "media_context_read_limit" };
      interpretations.push(...media.rows);
    }
    return { conversation, messages: messages.rows, interpretations };
  }));
  const complete = loaded.filter((item) => !item.excluded);
  return {
    asOf: cutoff, occurredSince, conversations: complete.map((item) => item.conversation),
    messages: complete.flatMap((item) => item.messages), mediaInterpretations: complete.flatMap((item) => item.interpretations),
    sourceInfo: {
      asOf: cutoff, occurredSince, limits, conversationsConsidered: recent.length,
      conversationsLoaded: complete.length, conversationLimitReached: (data || []).length > limits.conversations,
      excluded: Object.fromEntries(["context_read_limit", "media_context_read_limit"].map((reason) => [reason, loaded.filter((item) => item.excluded === reason).length])),
    },
  };
}

// Both actions reconstruct the same capped universe at the preview clock. The
// digest covers actual context/grounding, not just IDs. A changed source requires
// another preview; prepare never silently substitutes a different turn/context.
export async function previewHistoricalReplaySource(admin, { env = process.env, now = Date.now(), snapshot = null } = {}) {
  assertHistoricalReplayIsolation(env);
  if (snapshot && (!/^[a-f0-9]{64}$/.test(snapshot.fingerprint || "") || !Number.isFinite(Date.parse(snapshot.asOf))
    || Date.parse(snapshot.asOf) > now || now - Date.parse(snapshot.asOf) > HISTORICAL_REPLAY_SOURCE_LIMITS.previewMaxAgeMs)) {
    throw fail("historical_replay_preview_expired");
  }
  const source = await loadHistoricalReplaySource(admin, { asOf: snapshot?.asOf || new Date(now).toISOString() });
  const preview = selectHistoricalReplayCohort({ ...source, env, now: Date.parse(source.asOf) });
  const fingerprint = hash(JSON.stringify({ source, preview }));
  if (snapshot && snapshot.fingerprint !== fingerprint) throw fail("historical_replay_preview_changed");
  return { ...preview, sourceInfo: source.sourceInfo, sourceSnapshot: { asOf: source.asOf, fingerprint } };
}

export async function prepareHistoricalReplaySelection(admin, { turnKeys, sourceSnapshot, env = process.env, now = Date.now() }) {
  if (!sourceSnapshot) throw fail("historical_replay_preview_required", 400);
  const preview = await previewHistoricalReplaySource(admin, { env, now, snapshot: sourceSnapshot });
  const keys = new Set(turnKeys);
  const cases = preview.cases.filter((item) => keys.has(item.historicalTurnKey));
  if (cases.length !== keys.size) throw fail("cohort_contains_ineligible_turn", 400);
  const counts = Object.fromEntries(HISTORICAL_REPLAY_DOMAINS.map((domain) => [domain, cases.filter((item) => item.domain === domain).length]));
  return { ...preview, cases, counts, selected: cases.length };
}
