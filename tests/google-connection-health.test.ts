import assert from 'node:assert/strict';
import test from 'node:test';
import {googleReconnectRequired} from '../lib/auth/google-connection-health';
test('expired or revoked refresh authorization requires reconnection',()=>{
 assert.equal(googleReconnectRequired(400,{error:'invalid_grant'}),true);
});
test('outages, throttling, malformed responses and app configuration failures do not revoke user authorization',()=>{
 for(const [status,body] of [[503,{error:'invalid_grant'}],[429,{error:'rate_limit'}],[400,{error:'invalid_client'}],[400,null],[400,'invalid_grant'],[200,{error:'invalid_grant'}]] as const)assert.equal(googleReconnectRequired(status,body),false);
});
