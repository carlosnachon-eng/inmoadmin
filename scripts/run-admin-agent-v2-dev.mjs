import { getAdminSupabase } from "../lib/ejecutivo/workCenter.js";
import {
  assertAdminAgentV2Environment,
  createAdminAgentV2Session,
  executeAdminAgentV2RequiredActions,
  retrieveAdminAgentV2Session,
} from "../lib/agentsV2/openaiAdminAgent.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const message = arg("--message");
const respondContactId = arg("--respond-contact-id");
if (!message) throw new Error("usage: --message <sanitized text> [--respond-contact-id <opaque id>]");

assertAdminAgentV2Environment(process.env);
const input = [respondContactId ? `respondContactId opaco: ${String(respondContactId).slice(0,120)}` : null, "Mensaje del cliente:", String(message).slice(0,4000)].filter(Boolean).join("\n");
const db = getAdminSupabase();
let session = await createAdminAgentV2Session({ input });
const seen = new Set();

for (let step = 0; step < 8; step += 1) {
  session = await retrieveAdminAgentV2Session({ sessionId: session.id });
  if (session.status === "requires_action") {
    const key = JSON.stringify(session.required_actions || []);
    if (seen.has(key)) throw new Error("admin_agent_v2_repeated_required_action");
    seen.add(key);
    const handled = await executeAdminAgentV2RequiredActions({ db, session });
    if (!handled.handled) throw new Error("admin_agent_v2_unhandled_required_action");
    continue;
  }
  if (["failed", "cancelled"].includes(session.status)) throw new Error(`admin_agent_v2_${session.status}`);
  if (["idle", "completed"].includes(session.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 350));
}
session = await retrieveAdminAgentV2Session({ sessionId: session.id });
console.log(JSON.stringify({
  sessionId: session.id,
  status: session.status,
  requiredActions: (session.required_actions || []).map((item) => ({ type:item.type, name:item.name || null })),
  mode: "read_only_dev",
  outbound: false,
}, null, 2));
