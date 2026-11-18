import { getAdminSupabase } from '../../../lib/ejecutivo/workCenter';
import { createAdminIdentityPilotHandler } from '../../../lib/respond/adminIdentityPilot.mjs';

export const config = { maxDuration: 10, api: { bodyParser: false } };
export default createAdminIdentityPilotHandler({ getDb: () => getAdminSupabase() });
