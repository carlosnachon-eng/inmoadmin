import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { manualDecision } from "./manualTurnFixture.mjs";
import { OPENAI_TEXT_OFF_GATES, OPENAI_TEXT_RUNTIME } from "../../lib/shadow/ai/openaiTextRuntime.js";
import { REAL_SHADOW_AUTO_AI_PROMPT_VERSION, REAL_SHADOW_AI_SYSTEM_PROMPT } from "../../lib/shadow/ai/realPrompt.js";

export const textEnv = { ...Object.fromEntries(OPENAI_TEXT_OFF_GATES.map(k => [k, "false"])),
  VERCEL_ENV: "preview", SUPABASE_ENVIRONMENT: "dev", NEXT_PUBLIC_SUPABASE_URL: "https://hjfwjnejbcpmknvfpdcq.supabase.co",
  SHADOW_AI_AUTO_REAL_DEV_TEST_ENABLED: "true", SHADOW_AI_AUTO_REAL_ENABLED: "true", SHADOW_AI_ENABLED: "true", SHADOW_AI_PRODUCTION_ENABLED: "true",
  SHADOW_AI_ALLOW_REAL_MESSAGES: "true", SHADOW_RESPOND_ADMIN_CHANNEL_ID: "544519", SHADOW_CONVERSATION_ACTIONS_ENABLED: "true",
  SHADOW_AI_AUTO_REAL_NOT_BEFORE: "2026-01-01T00:00:00Z", OPENAI_API_KEY: "synthetic-only", OPENAI_ADMIN_AGENT_MODEL: "gpt-6-luna" };
export const textDecision = () => structuredClone(manualDecision);
export function textFixture() {
  const messageId = randomUUID(), conversationId = randomUUID(), turnKey = createHash("sha256").update(messageId).digest("hex");
  const occurredAt = new Date(Date.now() - 600000).toISOString();
  const envelope = { provider: "respond_admin", direction: "inbound", externalMessageId: randomUUID(), occurredAt,
    sanitizedText: "¿En qué parte se necesita el mantenimiento?", providerMetadata: { channelId: "544519", respondContactId: "123456" } };
  const tables = { shadow_messages: [{ id: messageId, conversation_id: conversationId, direction: "inbound", occurred_at: occurredAt,
    sanitized_text: envelope.sanitizedText, provider_metadata: {}, external_message_id: envelope.externalMessageId, attachment_metadata: [] }],
    shadow_conversations: [{ id: conversationId, provider: "respond_admin", channel: "544519", respond_contact_id: "123456" }],
    shadow_ai_runs: [], shadow_ai_decisions: [], shadow_conversation_actions: [] };
  const db = memoryDatabase(tables);
  const options = { env: { ...textEnv }, inputMode: "auto_real_shadow", textRuntime: OPENAI_TEXT_RUNTIME,
    promptVersion: REAL_SHADOW_AUTO_AI_PROMPT_VERSION, systemPrompt: REAL_SHADOW_AI_SYSTEM_PROMPT, persistInputSnapshot: true,
    turnMetadata: { turnKey, messageIds: [messageId] } };
  return { db, tables, messageId, envelope, options, turnKey };
}
export function memoryDatabase(tables) {
  const writes = [];
  const valueAt = (row, key) => key.includes("->>") ? row[key.split("->>")[0]]?.[key.split("->>")[1]] : row[key];
  const db = { tables, writes, failTable: null, from(table) {
    let filters = [], one = false, limit = Infinity, op = "read", patch, cols = "*", order;
    const q = { select(c = "*") { cols = c; return q; }, eq(k,v) { filters.push(r => valueAt(r,k) === v); return q; },
      in(k,vs) { filters.push(r => vs.includes(valueAt(r,k))); return q; }, neq(k,v) { filters.push(r => valueAt(r,k) !== v); return q; },
      is(k,v) { filters.push(r => (valueAt(r,k) ?? null) === v); return q; }, gte(k,v) { filters.push(r => valueAt(r,k) >= v); return q; },
      gt(k,v) { filters.push(r => valueAt(r,k) > v); return q; }, order(k,{ascending=true}={}) { order = {k,ascending}; return q; },
      limit(n) { limit=n; return q; }, single() { one=true; return q; }, maybeSingle() { one=true; return q; },
      insert(v) { op="insert"; patch=v; return q; }, update(v) { op="update"; patch=v; return q; },
      upsert() { throw Error("unexpected_mutation"); }, delete() { throw Error("unexpected_mutation"); },
      then(ok,bad) {
        if (db.failTable === table && op !== "read") return Promise.resolve({error:{code:"synthetic_storage_failure"},data:null}).then(ok,bad);
        let rows=(tables[table] || []).filter(r => filters.every(f=>f(r)));
        if(order) rows.sort((a,b) => String(valueAt(a,order.k)).localeCompare(String(valueAt(b,order.k))) * (order.ascending ? 1 : -1));
        rows=rows.slice(0,limit);
        if(op==="insert") {
          const row={id:randomUUID(),created_at:new Date().toISOString(),...structuredClone(patch)};
          if((tables[table]||[]).some(r=>r.id===row.id || (table==="shadow_conversation_actions" && r.turn_key===row.turn_key))) return Promise.resolve({data:null,error:{code:"23505"}}).then(ok,bad);
          (tables[table]||=[]).push(row); rows=[row]; writes.push({table,op});
        }
        if(op==="update") { rows.forEach(r=>Object.assign(r,structuredClone(patch))); writes.push({table,op}); }
        const result=structuredClone(rows).map(r=>cols==="*"?r:Object.fromEntries(cols.split(",").map(k=>[k,valueAt(r,k)])));
        return Promise.resolve({data:one?result[0]||null:result,error:null}).then(ok,bad);
      } }; return q;
  }, rpc() { throw Error("unexpected_rpc"); } };
  return db;
}
export function syntheticOpenAi({ decision = textDecision(), mode = "completed", usage, model = "gpt-6-luna", onCreate } = {}) {
  const calls = [], contexts = [], sessions = [];
  const json = value => ({ ok: true, status: 200, json: async () => value });
  const fetchImpl = async (url, options = {}) => {
    assert.ok(url.startsWith("https://api.openai.com/v1/agents/sessions"), "no Anthropic / outbound");
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (url.endsWith("/events")) return { ok:true, status:204 };
    if (options.method === "POST") {
      const body=JSON.parse(options.body); contexts.push(JSON.parse(body.input));
      const session={id:`sess_synthetic${sessions.length+1}`,agent:{id:"agent_synthetic",model}}; sessions.push(session);
      await onCreate?.(body);
      if(mode==="http") return {ok:false,status:400,json:()=>{throw Error("raw_error_body_must_not_be_read");}};
      if(mode==="uncertain_create") return new Promise(()=>{});
      return json(session);
    }
    if(mode==="timeout") return new Promise(()=>{}); // deliberately ignores abort
    const n=Number(url.match(/sess_synthetic(\d+)/)?.[1])-1;
    if(url.includes("/turns?")) return json({has_more:false,data:[{id:"turn_synthetic",agent_id:"agent_synthetic",status: mode==="failed"?"failed":"completed",
      usage:usage===undefined ? {input_tokens:100,output_tokens:30,input_tokens_details:{cached_tokens:20},output_tokens_details:{reasoning_tokens:10}}:usage}]});
    if(url.includes("/items?")) {
      const output=typeof decision==="function" ? decision(contexts[n], n) : decision;
      return json({has_more:false,data:[{type:"message",role:"assistant",content:[{type:"output_text",text:typeof output==="string"?output:JSON.stringify(output)}]}]});
    }
    return json({...sessions[n],status:"idle",required_actions:[]});
  };
  return {fetchImpl,calls,contexts,sessions};
}
