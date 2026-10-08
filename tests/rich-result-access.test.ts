import assert from 'node:assert/strict';
import test from 'node:test';
import type {Sql} from 'postgres';
import {CallingAccessStore} from '../lib/calling-access';
import {resultInputForFeature} from '../lib/harness/result-schema';
const base={outcome:'completed',summary:'Plan',details:'Plan',verified:true,externalChange:false,blocksOnly:true,blocks:[{type:'text',style:'paragraph',text:'Visit the park.'}]};
test('rich results and calling are enabled for everyone by default',async()=>{
 const client=(async()=>[]) as unknown as Sql;
 assert.equal((await new CallingAccessStore(client,'rich_result_blocks').read()).mode,'everyone');
 assert.equal((await new CallingAccessStore(client,'voice_calling').read()).mode,'everyone');
});
test('disabled feature excludes and strips blocks and blocks-only output',()=>{
 const disabled=resultInputForFeature(false);assert.equal('blocks' in disabled.shape,false);assert.equal('blocksOnly' in disabled.shape,false);
 const parsed=disabled.parse(base);assert.equal('blocks' in parsed,false);assert.equal('blocksOnly' in parsed,false);
 const enabled=resultInputForFeature(true).parse(base);assert.ok("blocks" in enabled && "blocksOnly" in enabled);assert.deepEqual(enabled.blocks,base.blocks);assert.equal(enabled.blocksOnly,true);
});

test('explicit saved rich-result restrictions still override the default', async () => {
 const {callingEnabled} = await import('../lib/calling-policy');
 const none = (async()=>[{value:{mode:'none',users:[]},revision:1}]) as unknown as Sql;
 assert.equal(callingEnabled(await new CallingAccessStore(none,'rich_result_blocks').read(),'user@example.invalid'),false);
 const excluded = (async()=>[{value:{mode:'everyone',users:[{email:'excluded@example.invalid',enabled:false}]},revision:1}]) as unknown as Sql;
 const policy=await new CallingAccessStore(excluded,'rich_result_blocks').read();
 assert.equal(callingEnabled(policy,'excluded@example.invalid'),false);
 assert.equal(callingEnabled(policy,'other@example.invalid'),true);
});
