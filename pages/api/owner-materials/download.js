import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { createMaterialDownloadHandler } from "../../../lib/ownerMaterials/download.js";

// Narrow bearer capability for one approved PDF, not anon access to Storage or a bucket listing.
export default createMaterialDownloadHandler({ createAdmin: getAdminSupabase });
