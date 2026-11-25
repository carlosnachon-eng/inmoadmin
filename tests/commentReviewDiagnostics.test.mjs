import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDiagnostic,reviewDatabaseError} from '../lib/messaging/commentAgent/diagnostics.js';
import {businessConfig} from '../lib/messaging/instagram/business/config.js';
import {messengerConfig} from '../lib/messaging/facebook/messenger/config.js';
test('missing branch configuration reproduces disabled platform before any database call',()=>{
 const env={VERCEL_ENV:'preview',NEXT_PUBLIC_SUPABASE_URL:'https://hjfwjnejbcpmknvfpdcq.supabase.co'};
 assert.equal(businessConfig(env),null);
 assert.equal(messengerConfig(env),null);
 // Enabling only a gate is insufficient; never weaken the remaining validation.
 assert.throws(()=>businessConfig({...env,APP_ENV:'preview',INSTAGRAM_BUSINESS_ENABLED:'true'}),/business_configuration_incomplete/);
 assert.throws(()=>messengerConfig({...env,APP_ENV:'preview',FACEBOOK_MESSENGER_ENABLED:'true'}),/configuration_incomplete/);
});
test('diagnostics disclose only fixed stage/code and discard sensitive errors',()=>{
 const e={code:'42501',message:'private customer content',details:'token',hint:'ciphertext'};
 assert.deepEqual(reviewDiagnostic('journal_read',reviewDatabaseError(e)),{stage:'journal_read',code:'42501'});
 assert.deepEqual(reviewDiagnostic('configuration',Error('business_environment_denied')),{stage:'configuration',code:'business_environment_denied'});
 assert.deepEqual(reviewDiagnostic('secret',e),{stage:'unknown',code:'unclassified'});
 assert.deepEqual(reviewDiagnostic('journal_read',reviewDatabaseError({...e,code:'secret'})),{stage:'journal_read',code:'unclassified'});
 assert.equal(JSON.stringify(reviewDatabaseError(e)).includes('token'),false);
});
