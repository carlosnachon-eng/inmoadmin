import { createClient } from "@supabase/supabase-js";
import { createCommercialInventoryHandler, createPublicInventoryDb } from '../../../lib/respond/inventoryCommercial.mjs';
import { createInventoryControl } from '../../../lib/respond/inventoryControl.mjs';

// No model, sender, workflow, queue, private table or business mutation.
export const config = { maxDuration: 10, api: { bodyParser: false } };
export default createCommercialInventoryHandler({
  getDb: () => createPublicInventoryDb(createClient, process.env),
  sharedControl: createInventoryControl({
    getClient: () => createPublicInventoryDb(createClient, process.env),
    capability: () => process.env.RESPOND_INVENTORY_CONTROL_CAPABILITY,
  }),
});
