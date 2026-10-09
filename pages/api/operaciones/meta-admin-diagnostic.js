import {authorizeShadowAdministrator} from '../../../lib/shadow/ai/apiAuth.js';
import {createDiagnosticHandler} from '../../../lib/messaging/metaAdminInbox/diagnostic.js';
export default createDiagnosticHandler({authorize:authorizeShadowAdministrator});
