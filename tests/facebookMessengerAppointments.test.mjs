import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const route=readFileSync(new URL('pages/api/operaciones/facebook-messenger-appointments.js',root),'utf8');
const ui=readFileSync(new URL('components/FacebookMessengerConversation.js',root),'utf8');
const sql=readFileSync(new URL('supabase/migrations/20261019100000_facebook_thread_client_link.sql',root),'utf8');
test('appointment operations check Messenger thread access and client scope',()=>{
 for(const token of ['fb_messenger_inbox_v1','fb_messenger_thread_client_v1',".eq('cliente_id',link.client_id)",'sameOriginAdminRequest(req)'])assert.ok(route.includes(token),token);
});
test('appointment creation and cancellation sync KPIs',()=>{
 for(const token of ["op==='create'","op==='cancel'",'syncKpis(db,','citas_agendadas','citas_efectivas','citas_calificadas'])assert.ok(route.includes(token),token);
});
test('appointment UI uses live options and a confirmation for cancel',()=>{
 for(const token of ["appointmentRequest('options')","appointmentRequest('create'","appointmentRequest('cancel'","window.confirm('¿Cancelar esta cita?')"])assert.ok(ui.includes(token),token);
});
test('Facebook CRM linkage is isolated, private and thread-scoped',()=>{
 for(const token of ['facebook_messenger_private.thread_clients','enable row level security','facebook_messenger_private.allowed','p_op'])assert.ok(sql.includes(token),token);
});
