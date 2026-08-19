import { createClient } from "@supabase/supabase-js";
import { SHADOW_SYNTHETIC_FIXTURES } from "../lib/shadow/fixtures.js";
import { processSyntheticShadowFixture } from "../lib/shadow/pipeline.js";

const DEV_REF = "hjfwjnejbcpmknvfpdcq";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
if (process.env.SUPABASE_ENVIRONMENT !== "dev" || !url.includes(DEV_REF) || url.includes("bnzrnizrmonjxlktbhlp")) {
  throw new Error("Runner FASE2A-QA bloqueado fuera de DEV");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta service role DEV");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
for (const fixture of SHADOW_SYNTHETIC_FIXTURES) results.push(await processSyntheticShadowFixture(admin, fixture));
results.push(await processSyntheticShadowFixture(admin, SHADOW_SYNTHETIC_FIXTURES[0]));
process.stdout.write(JSON.stringify({ accepted: results.filter((x) => x.status === "accepted").length, duplicate: results.filter((x) => x.status === "duplicate").length }));
