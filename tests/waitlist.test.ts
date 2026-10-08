import assert from 'node:assert/strict';import test from 'node:test';
import {waitlistInputSchema} from '../lib/waitlist';import {POST} from '../app/api/waitlist/route';
test('waitlist normalizes email without altering plus aliases',()=>{assert.equal(waitlistInputSchema.parse({email:'  Alex+Dash@Example.com '}).email,'alex+dash@example.com');for(const email of ['','bad','a@', 'x'.repeat(255)+'@example.com'])assert.equal(waitlistInputSchema.safeParse({email}).success,false);});
test('waitlist rejects foreign origins, invalid email and oversized requests before storage',async()=>{
 const request=(body:string,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/waitlist',{method:'POST',headers:{origin,'content-type':'application/json'},body});
 assert.equal((await POST(request('{"email":"alex@example.com"}','https://other.example'))).status,403);
 assert.equal((await POST(request('{"email":"invalid"}'))).status,400);
 assert.equal((await POST(request('no-json'))).status,400);
 assert.equal((await POST(request('x'.repeat(4097)))).status,413);
});
