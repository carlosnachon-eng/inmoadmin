import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { createMetaObserverHandler } from "../../../lib/messaging/metaObserver/receiver.js";

// Signature is checked over raw bytes, before JSON parsing. No commercial work.
export const config = { api: { bodyParser: false }, maxDuration: 10 };
export default createMetaObserverHandler({ getDb: getAdminSupabase });
