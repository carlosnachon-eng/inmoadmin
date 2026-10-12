import {authorizeShadowAdministrator} from '../../../lib/shadow/ai/apiAuth.js';
import {createManualRelayClient} from '../../../lib/messaging/instagram/manualRelay.js';

export const config={api:{bodyParser:{sizeLimit:'4kb'}}};
export default createManualRelayClient({authorize:authorizeShadowAdministrator});
