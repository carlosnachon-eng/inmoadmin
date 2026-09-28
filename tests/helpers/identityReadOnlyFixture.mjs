import assert from "node:assert/strict";
import { memoryAdmin } from "./condominiumIdentityFixture.mjs";

// Real resolvers use this in-memory client. Record attempted mutations before
// throwing, including RPCs, so a swallowed tool error cannot hide a write.
export function instrumentIdentityAdmin(tables = {}, { allowAudit = false } = {}) {
  const admin = memoryAdmin(tables), mutations = [], auditEvents = [];
  const mutation = (table, method, value) => {
    mutations.push({ table, method });
    if (allowAudit && table === "respond_identity_audit" && method === "insert") {
      auditEvents.push(structuredClone(value));
      return Promise.resolve({ data: null, error: null });
    }
    assert.fail(`unexpected_mutation:${table}:${method}`);
  };
  const from = admin.from;
  admin.from = (table) => {
    const query = from(table);
    for (const method of ["insert", "upsert", "update", "delete", "rpc"]) {
      query[method] = (value) => mutation(table, method, value);
    }
    return query;
  };
  admin.rpc = () => mutation("rpc", "rpc");
  return { admin, mutations, auditEvents };
}
