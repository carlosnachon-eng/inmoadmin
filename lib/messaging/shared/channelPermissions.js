// Shared policy for commercial inbox channels. Channel-specific backend checks
// remain authoritative; this module must not grant database or Meta permissions.
export const COMMERCIAL_INBOX_ROLES=Object.freeze(['admin','coord_operaciones','gerente_ventas','asesor','juridico']);
export const COMMERCIAL_SUPERVISOR_ROLES=Object.freeze(['admin','gerente_ventas']);
export function mayViewAssignedThread(role,assigned){
 return COMMERCIAL_INBOX_ROLES.includes(role)&&(COMMERCIAL_SUPERVISOR_ROLES.includes(role)||assigned===true);
}
export function mayReplyToThread({role,assigned,windowOpen,senderEnabled}){
 return mayViewAssignedThread(role,assigned)&&windowOpen===true&&senderEnabled===true;
}
export const CHANNEL_ACTIONS=Object.freeze(['appointment','property','attachment','voice']);
