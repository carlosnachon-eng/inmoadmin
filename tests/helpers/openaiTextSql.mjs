// Test-only PostgREST subset: the unchanged production processors drive actual
// SQL, with every Shadow read/write restricted to recorded synthetic fixtures.
import assert from "node:assert/strict";
export const literal = v => v == null ? "null" : typeof v === "boolean" || typeof v === "number" ? String(v)
  : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
const col = key => {
  assert.match(key, /^[a-z_]+(?:->>[a-z_]+)?$/);
  return key.includes("->>") ? `"${key.split("->>")[0]}"->>${literal(key.split("->>")[1])}` : `"${key}"`;
};
export function textSqlDatabase(query, inventory) {
  const operations=[];
  const db = { operations, failTable:null, from(table) {
    assert.match(table,/^[a-z_]+$/);
    let fields="*",filters=[],orders=[],limit="",op="select",payload,one=false;
    const scope = table==="shadow_conversations" ? `id in (${inventory.conversations.map(literal).join(",")||"null"})`
      : table==="shadow_messages" ? `id in (${inventory.messages.map(literal).join(",")||"null"})`
      : table==="shadow_ai_runs" ? `message_id in (${inventory.messages.map(literal).join(",")||"null"})`
      : ["shadow_media_interpretations","shadow_media_retrieval_queue"].includes(table) ? `external_message_id in (${inventory.messages.map(literal).join(",")||"null"})`
      : ["shadow_ai_decisions","shadow_conversation_actions"].includes(table) ? `ai_run_id in (select id from public.shadow_ai_runs where message_id in (${inventory.messages.map(literal).join(",")||"null"}))` : null;
    // No unrelated rows are read by cron selection or supersession cleanup.
    if(scope) filters.push(scope);
    const q={select(value="*"){assert.match(value,/^[a-z_,*]+$/);fields=value;return q;},
      eq(k,v){filters.push(`${col(k)}=${literal(v)}`);return q;},in(k,vs){filters.push(`${col(k)} in (${vs.map(literal).join(",")||"null"})`);return q;},
      is(k,v){assert.equal(v,null);filters.push(`${col(k)} is null`);return q;},neq(k,v){filters.push(`${col(k)}<>${literal(v)}`);return q;},
      gte(k,v){filters.push(`${col(k)}>=${literal(v)}`);return q;},gt(k,v){filters.push(`${col(k)}>${literal(v)}`);return q;},
      order(k,{ascending=true}={}){orders.push(`${col(k)} ${ascending?"asc":"desc"}`);return q;},limit(n){assert.ok(Number.isInteger(n));limit=` limit ${n}`;return q;},
      single(){one=true;return q;},maybeSingle(){one=true;return q;},insert(value){op="insert";payload=value;return q;},update(value){op="update";payload=value;return q;},
      then(ok,bad){
        if(op!=="select") assert.ok(["shadow_ai_runs","shadow_ai_decisions","shadow_conversation_actions"].includes(table));
        if(db.failTable===table&&op!=="select")return Promise.resolve({data:null,error:{code:"synthetic_persistence_failure"}}).then(ok,bad);
        let sql;
        if(op==="insert"){
          if(table==="shadow_ai_runs")assert.ok(inventory.messages.includes(payload.message_id));
          const entries=Object.entries(payload);sql=`insert into public.${table} (${entries.map(([k])=>col(k)).join(",")}) values (${entries.map(([,v])=>literal(v)).join(",")}) returning ${fields}`;
        } else {
          sql=op==="update"?`update public.${table} set ${Object.entries(payload).map(([k,v])=>`${col(k)}=${literal(v)}`).join(",")}`:`select ${fields} from public.${table}`;
          sql+=(filters.length?` where ${filters.join(" and ")}`:"")+(op==="update"?` returning ${fields}`:(orders.length?` order by ${orders.join(",")}`:"")+limit);
        }
        operations.push({table,operation:op});
        return query(`begin; set local role service_role; ${sql}; commit;`).then(rows=>({data:one?rows[0]||null:rows,error:null}),error=>({data:null,error:{code:error.code||"database_failure"}})).then(ok,bad);
      }};return q;
  },rpc(){throw Error("tool_rpc_forbidden");}};
  return db;
}
