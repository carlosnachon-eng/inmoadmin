import operator from './meta-admin-shadow-once.js';
import { authorizeShadowAdministrator } from '../../../lib/shadow/ai/apiAuth.js';
import { createShadowOnceSelfInvoke } from '../../../lib/messaging/metaAdminCapture/shadowOnceSelfInvoke.js';

export const config={api:{bodyParser:{sizeLimit:'1kb'}},maxDuration:120};
export default createShadowOnceSelfInvoke({authorize:authorizeShadowAdministrator,operator});
