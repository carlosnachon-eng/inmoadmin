import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectOAuthShapeDiagnostic} from '../lib/messaging/instagram/business/diagnosticDisplay.js';
const fixture=()=>({stage:'short_token_shape',short_token_response_shape:{root_type:'object',top_level_keys:['access_token','user_id'],top_level_types:[{key:'access_token',type:'string'},{key:'user_id',type:'number'}],data_present:false,data_type:'undefined',data_length:null,data_items:[]}});
test('renders only structure from sanitized API contract',()=>assert.deepEqual(projectOAuthShapeDiagnostic(fixture()),fixture().short_token_response_shape));
test('drops values, nested raw data, unknown keys and unsafe type text',()=>{
 const d=fixture(),s=d.short_token_response_shape;s.access_token='SECRET';s.top_level_keys.push('SECRET');s.top_level_types.push({key:'SECRET',type:'string',value:'SECRET'},{key:'data',type:'SECRET'});s.data_items=[{type:'object',keys:['access_token','SECRET'],field_types:[{key:'access_token',type:'string',value:'SECRET'}],raw:'SECRET'}];
 const view=JSON.stringify(projectOAuthShapeDiagnostic(d));assert.ok(!view.includes('SECRET'));assert.ok(view.includes('[redacted_field]'));
});
test('invalid diagnostics are not rendered',()=>{
 for(const d of [null,[],{}, {stage:'other'}, {stage:'short_token_shape',short_token_response_shape:{root_type:'SECRET',data_type:'array'}}])assert.equal(projectOAuthShapeDiagnostic(d),null);
});
test('bounds output and accepts only nonnegative integer data length',()=>{
 const d=fixture(),s=d.short_token_response_shape;s.top_level_keys=Array(100).fill('data');s.data_length='SECRET';s.data_items=Array(10).fill({type:'null'});
 const v=projectOAuthShapeDiagnostic(d);assert.equal(v.top_level_keys.length,32);assert.equal(v.data_items.length,3);assert.equal(v.data_length,null);
});
test('Preview UI renders projection as text without raw HTML or logging',()=>{
 const source=readFileSync(new URL('../pages/operaciones/instagram-business-setup.js',import.meta.url),'utf8');
 assert.ok(source.includes("process.env.VERCEL_ENV!=='preview'"));assert.ok(source.includes('error.safeShape=projectOAuthShapeDiagnostic(d)'));assert.ok(source.includes('JSON.stringify(shape,null,2)'));
 assert.ok(!source.includes('dangerouslySetInnerHTML'));assert.ok(!source.includes('console.'));
});
