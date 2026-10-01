import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Local-only PostgREST-shaped fixture; never connects to a provider or database.
export function memoryDb(seed = {}, rpc = {}) {
  const tables = structuredClone(seed), operations = [];
  return { tables, operations,
    async rpc(name, args) { operations.push({ table: name, op: "rpc", args }); return rpc[name] ? rpc[name](args) : { error: new Error(`unexpected_rpc:${name}`) }; },
    from(table) {
      let op = "select", payload, predicates = [], ordering, count, single = false;
      const q = {
        select() { return q; }, insert(p) { op = "insert"; payload = p; return q; }, update(p) { op = "update"; payload = p; return q; },
        eq(k, v) { predicates.push(r => r[k] === v); return q; }, is(k, v) { predicates.push(r => (r[k] ?? null) === v); return q; },
        not(k, _operator, v) { predicates.push(r => (r[k] ?? null) !== v); return q; },
        in(k, v) { predicates.push(r => v.includes(r[k])); return q; },
        gte(k, v) { predicates.push(r => r[k] >= v); return q; }, lte(k, v) { predicates.push(r => r[k] <= v); return q; },
        gt(k, v) { predicates.push(r => r[k] > v); return q; }, order(k, o) { ordering = [k, o?.ascending !== false]; return q; },
        limit(n) { count = n; return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
        then(ok, fail) {
          operations.push({ table, op, payload });
          const rows = tables[table] ||= [];
          let selected = rows.filter(r => predicates.every(p => p(r)));
          if (ordering) { const [k, asc] = ordering; selected.sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (asc ? 1 : -1)); }
          if (count !== undefined) selected = selected.slice(0, count);
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
