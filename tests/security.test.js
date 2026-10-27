import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, redact } from '../src/security.js';

test('passwords are salted and verified',()=>{const a=hashPassword('correct horse battery');const b=hashPassword('correct horse battery');assert.notEqual(a,b);assert.equal(verifyPassword('correct horse battery',a),true);assert.equal(verifyPassword('wrong password',a),false)});
test('short passwords are rejected',()=>assert.throws(()=>hashPassword('short'),/10 characters/));
test('credential values use authenticated encryption',()=>{const encrypted=encryptSecret('super-secret');assert.doesNotMatch(encrypted,/super-secret/);assert.equal(decryptSecret(encrypted),'super-secret')});
test('redaction removes secret values from structured logs',()=>assert.doesNotMatch(redact({authorization:'Bearer abc123'},['abc123']),/abc123/));
