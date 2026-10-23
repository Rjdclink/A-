import test from 'node:test';
import assert from 'node:assert/strict';
import {neonTLSConnectionString} from '../src/neon.mjs';

test('Neon PostgreSQL connections retain certificate and hostname verification across driver upgrades',()=>{
 const original='postgresql://service:example-secret@ep-demo.us-east-2.aws.neon.tech/app?sslmode=require&channel_binding=require';
 const corrected=new URL(neonTLSConnectionString(original));
 assert.equal(corrected.searchParams.get('sslmode'),'verify-full');
 assert.equal(corrected.searchParams.get('channel_binding'),'require');
 assert.equal(corrected.password,'example-secret');
});
test('non-Neon PostgreSQL connection settings remain unchanged',()=>{
 const local='postgres://postgres:testing@localhost:5432/test?sslmode=disable';
 assert.equal(neonTLSConnectionString(local),local);
});
