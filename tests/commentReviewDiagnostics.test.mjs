import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDiagnostic,reviewDatabaseError} from '../lib/messaging/commentAgent/diagnostics.js';
test('diagnostics disclose only fixed stage/code and discard sensitive errors',()=>{
 const e={code:'42501',message:'private customer content',details:'token',hint:'ciphertext'};
 assert.deepEqual(reviewDiagnostic('journal_read',reviewDatabaseError(e)),{stage:'journal_read',code:'42501'});
 assert.deepEqual(reviewDiagnostic('configuration',Error('business_environment_denied')),{stage:'configuration',code:'business_environment_denied'});
 assert.deepEqual(reviewDiagnostic('secret',e),{stage:'unknown',code:'unclassified'});
 assert.deepEqual(reviewDiagnostic('journal_read',reviewDatabaseError({...e,code:'secret'})),{stage:'journal_read',code:'unclassified'});
 assert.equal(JSON.stringify(reviewDatabaseError(e)).includes('token'),false);
});
