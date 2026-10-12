import {sanitizeShadowText} from '../../shadow/coordinator.js';

export const manualUuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
export function validManualText(text) {
  return typeof text==='string'&&text.length>0&&text.length<=2000&&text===text.trim()
    &&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069<>]/.test(text)
    &&sanitizeShadowText(text).text===text&&!sanitizeShadowText(text).rejected;
}
