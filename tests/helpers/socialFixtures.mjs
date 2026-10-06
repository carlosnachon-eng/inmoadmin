import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Local-only PostgREST-shaped fixture; never connects to a provider or database.
export function memoryDb(seed = {}, rpc = {}) {
  const tables = structuredClone(seed), operations = [];
  return { tables, operations,
    async rpc(name, args) {
      operations.push({ table: name, op: "rpc", args });
      if (rpc[name]) return rpc[name](args);
      if (name === "claim_respond_execution_v1") return {data:{managed:false},error:null};
      // Default fixtures have no human events. Pause/locking semantics are
      // certified separately against the real PostgreSQL RPCs, not this fake.
      if (name === "read_respond_human_pause_v1") return {data:{blocked:false},error:null};
      if (name === "begin_sales_human_guarded_send_v1") return {data:{allowed:true},error:null};
      if (name === "read_social_route_context_v1") {
        const rows = (tables.social_message_routes || []).filter(r => r.respond_contact_id === args.p_contact_id
          && r.source_channel_id === args.p_channel_id && r.destination !== "HUMAN_REVIEW")
          .sort((a,b) => ["occurred_at","created_at","id"].map(k => String(b[k]||"").localeCompare(String(a[k]||""))).find(n => n) || 0);
        return { data: { current: rows[0] || null, historical: rows.find(r => r.occurred_at <= args.p_at) || null }, error: null };
      }
      return { error: new Error(`unexpected_rpc:${name}`) };
    },
    from(table) {
      let op = "select", payload, predicates = [], ordering = [], count, offset = 0, single = false;
      const ilike=(row,key,pattern)=>{
        const escaped=String(pattern).replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/%/g,".*").replace(/_/g,".");
        return new RegExp(`^${escaped}$`,"iu").test(String(row[key]??""));
      };
      const q = {
        select() { return q; }, insert(p) { op = "insert"; payload = p; return q; }, update(p) { op = "update"; payload = p; return q; },
        eq(k, v) { predicates.push(r => r[k] === v); return q; }, is(k, v) { predicates.push(r => (r[k] ?? null) === v); return q; },
        neq(k,v) { predicates.push(r=>r[k]!==v); return q; },
        not(k, _operator, v) { predicates.push(r => (r[k] ?? null) !== v); return q; },
        in(k, v) { predicates.push(r => v.includes(r[k])); return q; },
        ilike(k,v) { predicates.push(r=>ilike(r,k,v)); return q; },
        or(clause) { const filters=clause.split(",").map(part=>{const match=part.match(/^(\w+)\.ilike\.(.+)$/); if(!match)throw new Error("unsupported_fixture_filter"); return match;}); predicates.push(r=>filters.some(([,k,v])=>ilike(r,k,v))); return q; },
        gte(k, v) { predicates.push(r => r[k] >= v); return q; }, lte(k, v) { predicates.push(r => r[k] <= v); return q; },
        gt(k, v) { predicates.push(r => r[k] > v); return q; }, order(k, o) { ordering.push([k, o?.ascending !== false]); return q; },
        limit(n) { count = n; return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
        range(start,end) { offset=start;count=end-start+1;return q; },
        then(ok, fail) {
          operations.push({ table, op, payload });
          const rows = tables[table] ||= [];
          let selected = rows.filter(r => predicates.every(p => p(r)));
          if (ordering.length) selected.sort((a,b) => ordering.map(([k,asc]) => String(a[k]).localeCompare(String(b[k])) * (asc?1:-1)).find(n=>n) || 0);
          if (count !== undefined) selected = selected.slice(offset, offset+count);
          if (op === "insert") { selected = [payload].flat().map(p => ({ id: randomUUID(), created_at: new Date().toISOString(), ...p })); rows.push(...selected); }
          if (op === "update") selected.forEach(r => Object.assign(r, payload));
          return Promise.resolve({ data: structuredClone(single ? selected[0] || null : selected), error: null }).then(ok, fail);
        },
      }; return q;
    },
  };
}

// Execute the real module with only its IO dependencies replaced by explicit synthetic modules.
export async function importWithStubs(file, replacements) {
  let source = await readFile(file, "utf8");
  for (const [specifier, exports] of Object.entries(replacements)) {
    const key = `social_fixture_${randomUUID()}`;
    globalThis[key] = exports;
    const stub = Object.keys(exports).map(name => `export const ${name}=globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}];`).join("\n");
    source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(`data:text/javascript;base64,${Buffer.from(stub).toString("base64")}`));
  }
  // Resolve remaining relative imports without rewriting their implementation.
  source = source.replace(/from\s+["'](\.[^"']+)["']/g, (_, relative) => `from ${JSON.stringify(new URL(relative, file).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

export const response = () => ({ setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
