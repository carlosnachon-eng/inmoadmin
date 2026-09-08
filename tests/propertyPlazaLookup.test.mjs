import test from "node:test";
import assert from "node:assert/strict";

import {
  lookupPropertyPlaza,
  normalizeEmpPublicId,
} from "../lib/respond/propertyPlazaLookup.js";

function fakeAdmin({ properties = [], plaza = null, propertyError = null, plazaError = null } = {}) {
  return {
    from(table) {
      const response = table === "propiedades"
        ? { data: properties, error: propertyError }
        : { data: plaza, error: plazaError };
      const query = {
        select: () => query,
        eq: () => query,
        limit: async () => response,
        maybeSingle: async () => response,
      };
      return query;
    },
  };
}

test("accepts only one exact canonical EMP public id", () => {
  assert.equal(normalizeEmpPublicId(" emp-mtpyq9rr "), "EMP-MTPYQ9RR");
  for (const value of ["EMP-MTPYQ9R", "EMP-MTPYQ9RR-extra", "MTPYQ9RR", "", null]) {
    assert.equal(normalizeEmpPublicId(value), null);
  }
});

test("resolves Veracruz exclusively through propiedades.plaza_id", async () => {
  const output = await lookupPropertyPlaza(fakeAdmin({
    properties: [{ public_id: "EMP-MTPYQ9RR", plaza_id: "plaza-veracruz" }],
    plaza: { code: "VERACRUZ" },
  }), "EMP-MTPYQ9RR");
  assert.deepEqual(output, {
    status: "resolved",
    propertyPublicId: "EMP-MTPYQ9RR",
    plazaCode: "VERACRUZ",
  });
});

test("resolves Puebla without exposing property data", async () => {
  const output = await lookupPropertyPlaza(fakeAdmin({
    properties: [{ public_id: "EMP-AAAAAAAA", plaza_id: "plaza-puebla" }],
    plaza: { code: "PUEBLA" },
  }), "EMP-AAAAAAAA");
  assert.deepEqual(Object.keys(output).sort(), ["plazaCode", "propertyPublicId", "status"]);
  assert.equal(output.plazaCode, "PUEBLA");
});

test("fails closed for absent, duplicate, unsupported and unavailable records", async () => {
  const cases = [
    [fakeAdmin(), "not_found"],
    [fakeAdmin({ properties: [{ plaza_id: "a" }, { plaza_id: "b" }] }), "ambiguous"],
    [fakeAdmin({ properties: [{ plaza_id: "x" }], plaza: { code: "OAXACA" } }), "unavailable"],
    [fakeAdmin({ propertyError: new Error("db") }), "unavailable"],
  ];
  for (const [admin, status] of cases) {
    const output = await lookupPropertyPlaza(admin, "EMP-AAAAAAAA");
    assert.equal(output.status, status);
    assert.equal(output.plazaCode, null);
  }
});
