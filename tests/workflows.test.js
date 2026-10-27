import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph, resolveTemplate, template } from '../src/workflows.js';

test('starter workflow is valid',()=>assert.deepEqual(validateGraph(template()).errors,[]));
test('workflow rejects cycles',()=>{const g=template();g.edges.push({id:'back',from:'action',to:'trigger'});assert.match(validateGraph(g).errors.join(' '),/cycle|trigger/i)});
test('workflow requires exactly one trigger',()=>{const g=template();g.nodes.push({id:'second',type:'webhook',name:'Webhook',config:{}});assert.match(validateGraph(g).errors.join(' '),/Exactly one/)});
test('workflow rejects disconnected actions',()=>{const g=template();g.edges=[];assert.match(validateGraph(g).errors.join(' '),/not connected/)});
test('mapping resolves only explicit data paths',()=>{const result=resolveTemplate({email:'{{trigger.customer.email}}',run:'{{execution.id}}'},{trigger:{customer:{email:'a@example.com'}},execution:{id:'exe_1'}});assert.deepEqual(result,{email:'a@example.com',run:'exe_1'});assert.throws(()=>resolveTemplate('{{process.env.SECRET}}',{}),/Missing value/)});
