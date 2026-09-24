// An in-memory capability, not an option that can be supplied by HTTP, env or
// metadata. Only the Replay executor may open its lifetime (architecture test).
const activeContexts = new WeakSet();

export async function withHistoricalReplaySchemaContext(operation) {
  const context = Object.freeze({});
  activeContexts.add(context);
  try { return await operation(context); }
  finally { activeContexts.delete(context); }
}

export function assertHistoricalReplaySchemaContext(context) {
  if (!context || !activeContexts.has(context)) throw new Error("historical_replay_schema_context_required");
}
