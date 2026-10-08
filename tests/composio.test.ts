import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMcpTools, assertConnectorTool } from '../lib/harness/mcp/client';
import { requireConnectorAuthSetup, ConnectorSetupRequiredError, connectorFailureMessage, connectorUserId, isAdditionalConnector, connectToolkit, connectorDetails, connectorSearchQuery, listConnectors, visibleConnectorAccounts } from '../lib/composio/service';
import { MemoryRunStore } from '../lib/harness/store';
import { interactionSummary } from '../lib/harness/question-summary';
import { isApprovalRequired } from '../lib/harness/actions';

async function setup({ slug = 'GITHUB_GET_USER', disconnected = false } = {}) {
 const store=new MemoryRunStore();
 const run=await store.createRun({userId:'one@example.com',decisionId:null,title:'Connector test',category:'social',request:'Use connected app',metadata:{}});
 await store.updateRun(run.id,{status:'running'});
 const app=slug.startsWith('OUTLOOK')?'outlook':slug.startsWith('GMAIL')?'gmail':'github';
 let calls=0;
 const dependencies={composioConfigured:()=>true,
  connectorSession:async()=>({}),
  connectorDetails:async()=>({slug:app,name:"GitHub",logo:"https://example.com/github.svg",noAuth:false}),
  isConnectorConnected:async()=>!disconnected,
  usableConnectors:async()=>({accounts:disconnected?[]:[{id:'owned',toolkit:{slug:app},status:'ACTIVE',isDisabled:false}],enabled:[]}),
  composioClient:()=>({tools:{getRawComposioToolBySlug:async()=>({slug,name:'App action',toolkit:{slug:app},inputParameters:{type:'object'}})}}),
  connectorRuntimeSession:async()=>({execute:async()=>{calls++;return {data:{ok:true},error:null};}}),
 } as unknown as NonNullable<Parameters<typeof loadMcpTools>[1]>;
 const registry=await loadMcpTools({runId:run.id,userId:run.userId,stepId:'step',store},dependencies);
 const execute=(args:Record<string,unknown>)=>(registry.tools.connector_execute.execute as Function)(args,{toolCallId:'test',messages:[]});
 return {execute,store,run,registry,calls:()=>calls};
}
test('connector identity is stable and isolated, and internal execution tools are rejected',()=>{
 assert.equal(connectorUserId(' ONE@example.com '),connectorUserId('one@example.com'));
 assert.notEqual(connectorUserId('one@example.com'),connectorUserId('two@example.com'));
 for(const tool of ['COMPOSIO_REMOTE_WORKBENCH','COMPOSIO_MULTI_EXECUTE_TOOL','COMPOSIO_MANAGE_CONNECTIONS','../../secrets'])assert.throws(()=>assertConnectorTool(tool));
});
test('an unowned account and a disconnected app cannot execute',async()=>{
 const fixture=await setup();
 await assert.rejects(()=>fixture.execute({toolSlug:'GITHUB_GET_USER',arguments:{},accountId:'someone-else'}),/not connected/);
 assert.equal(fixture.calls(),0);
 const disconnected=await setup({disconnected:true});
 await assert.rejects(()=>disconnected.execute({toolSlug:'GITHUB_GET_USER',arguments:{}}),/not connected/);
 assert.equal(disconnected.calls(),0);
});
test('a connected read executes and an email send pauses for approval before calling Composio',async()=>{
 const read=await setup();
 await read.execute({toolSlug:'GITHUB_GET_USER',arguments:{}});
 assert.equal(read.calls(),1);
 const send=await setup({slug:'OUTLOOK_SEND_EMAIL'});
 await assert.rejects(()=>send.execute({toolSlug:'OUTLOOK_SEND_EMAIL',arguments:{to:'friend@example.com',body:'hello'}}),isApprovalRequired);
 assert.equal(send.calls(),0);
 assert.equal((await send.store.getRun(send.run.id))?.status,'awaiting_approval');
});

test('inline connection request pauses without executing anything; existing connection needs no handoff',async()=>{
 const missing=await setup({disconnected:true});
 await assert.rejects(()=>(missing.registry.tools.connector_request_connection.execute as Function)({toolkit:'github',reason:'Read your project notes.'},{toolCallId:'connect',messages:[]}),isApprovalRequired);
 const snapshot=await missing.store.getSnapshot(missing.run.id);
 assert.equal(snapshot?.status,'awaiting_approval');
 assert.equal(snapshot?.actions[0].input.name,'GitHub');
 assert.equal(snapshot?.actions[0].status,'proposed');
 assert.equal(missing.calls(),0);
 const ready=await setup();
 const result=await (ready.registry.tools.connector_request_connection.execute as Function)({toolkit:'github',reason:'Read notes.'},{toolCallId:'connect',messages:[]});
 assert.equal(result.connected,true);
 assert.equal((await ready.store.getSnapshot(ready.run.id))?.actions.length,0);
});

test('connection receipt persists only a verified success; pending and skipped are distinct',async()=>{
 const f=await setup({disconnected:true});
 await assert.rejects(()=>(f.registry.tools.connector_request_connection.execute as Function)({toolkit:'github',reason:'Read notes.'},{toolCallId:'connect',messages:[]}),isApprovalRequired);
 const pending=(await f.store.getSnapshot(f.run.id))!.actions[0];
 assert.equal(interactionSummary(pending),null);
 await f.store.approveAction(pending.id,f.run.id,f.run.userId);
 await f.store.completeAction(pending.id,'executed',{connected:true,toolkit:'github'});
 const saved=(await f.store.getSnapshot(f.run.id))!.actions[0];
 assert.equal(interactionSummary(saved)?.connector?.status,'Connected');
 assert.equal(interactionSummary({...saved,result:{userSkipped:true}})?.connector?.status,'Skipped');
 assert.equal(interactionSummary({...saved,result:{}})?.connector?.status,'Not connected');
});

test('built-in Google apps are excluded and cannot start additional connection handoffs',async()=>{
 for(const slug of ['gmail','googlecalendar','google_calendar','googlesuper']) {
  assert.equal(isAdditionalConnector(slug),false);
  await assert.rejects(()=>connectToolkit('test@example.com',slug,'https://dash.example.invalid'),/existing Google connection/);
  await assert.rejects(()=>connectorDetails('test@example.com',slug),/existing Google connection/);
 }
 for(const slug of ['notion','googledrive','googlesheets'])assert.equal(isAdditionalConnector(slug),true);
});

test('short catalog searches do not reach the provider; X resolves to Twitter',async()=>{
 assert.equal(connectorSearchQuery(' X '),'twitter');
 assert.equal(connectorSearchQuery(' notion '),'notion');
 const result=await listConnectors('test@example.com','ab');
 assert.equal(result.shortSearch,true);
 assert.deepEqual(result.items,[]);
});

test('built-in Exa search cannot create a duplicate connection',async()=>{
 assert.equal(isAdditionalConnector('exa'),false);
 await assert.rejects(()=>connectorDetails('test@example.com','exa'),/built-in web_search_exa/);
 await assert.rejects(()=>connectToolkit('test@example.com','exa','https://dash.example.invalid'),/built-in web_search_exa/);
 for(const slug of ['googledrive','googledocs','googlesheets','googlephotos','twitter'])assert.equal(isAdditionalConnector(slug),true);
});


test('agent cannot propose duplicate cards or execute legacy Gmail tools',async()=>{
 const f=await setup({disconnected:true});
 for(const toolkit of ['gmail','googlecalendar','google_calendar','googlesuper','exa','composio','composio_search']) {
  await assert.rejects(()=>(f.registry.tools.connector_request_connection.execute as Function)({toolkit,reason:'Use my app.'},{toolCallId:'duplicate',messages:[]}));
 }
 assert.equal((await f.store.getSnapshot(f.run.id))?.actions.length,0);
 assert.equal((await f.store.getRun(f.run.id))?.status,'running');
 const legacy=await setup({slug:'GMAIL_GET_EMAIL'});
 await assert.rejects(()=>legacy.execute({toolSlug:'GMAIL_GET_EMAIL',arguments:{}}),/existing Google connection/);
 const result=await (legacy.registry.tools.connector_search.execute as Function)({query:'read my Gmail'},{toolCallId:'search',messages:[]});
 assert.deepEqual(result.connectedApps,[]);
 assert.equal(legacy.calls(),0);
});


test('connection preflight rejects missing app credentials and permits managed, hosted, and configured auth',async()=>{
 const client=(managed:string[]=[],required:unknown[]=[{name:'client_id'}],configs:unknown[]=[])=>({
  toolkits:{get:async()=>({composioManagedAuthSchemes:managed,authConfigDetails:[{fields:{authConfigCreation:{required}}}]})},
  authConfigs:{list:async()=>({items:configs})},
 }) as unknown as NonNullable<Parameters<typeof requireConnectorAuthSetup>[2]>;
 await assert.rejects(()=>requireConnectorAuthSetup('twitter','X',client()),ConnectorSetupRequiredError);
 await requireConnectorAuthSetup('notion','Notion',client(['OAUTH2']));
 await requireConnectorAuthSetup('app','App',client([],[]));
 await requireConnectorAuthSetup('app','App',client([],[{name:'region',default:'us'}]));
 await assert.rejects(()=>requireConnectorAuthSetup('app','App',client([],[{name:'client_id',default:''}])),ConnectorSetupRequiredError);
 await requireConnectorAuthSetup('twitter','X',client([],undefined,[{status:'ENABLED',isEnabledForToolRouter:true}]));
 await assert.rejects(()=>requireConnectorAuthSetup('twitter','X',client([],undefined,[{status:'DISABLED'}])),ConnectorSetupRequiredError);
 assert.match(connectorFailureMessage(new ConnectorSetupRequiredError('X'),'fallback'),/isn’t available/);
 assert.equal(connectorFailureMessage(new Error('provider secret'),'fallback'),'fallback');
});


test('requested catalog exclusions cannot create agent cards or start connections',async()=>{
 const excluded=["shopify", "spotify", "tiktok", "contacts_plus", "snowflake", "docusign", "netsuite", "d2lbrightspace", "blackboard", "kommo", "epic_games", "zoominfo", "xero", "highlevel", "aweber", "azure_monitor_activity_log", "box_mcp", "buffer", "clio_manage", "clover", "constant_contact", "coupa", "cradl_ai", "dribbble", "egnyte", "gagelist", "google_chat", "googlecontacts", "googleforms", "google_data_studio", "google_admin", "gusto", "help_scout", "jobber", "kintone_rest", "lightspeed", "linkedin_ads", "onenote", "microsoft_power_bi", "microsoft_todo", "paypal", "personio", "railway_mcp", "ramp", "reloadly", "salesforce_service_cloud", "sap_successfactors", "sharepoint_graph", "snapchat", "soundcloud", "vimeo", "wild_apricot", "wordpress_com", "workday", "zoom_chat"];
 const f=await setup({disconnected:true});
 for(const slug of excluded) {
  assert.equal(isAdditionalConnector(slug),false,slug);
  assert.equal(isAdditionalConnector(slug.toUpperCase()),false,slug);
  await assert.rejects(()=>connectToolkit('test@example.com',slug,'https://dash.example.invalid'),/not available in Dash/);
  await assert.rejects(()=>connectorDetails('test@example.com',slug),/not available in Dash/);
  await assert.rejects(()=>(f.registry.tools.connector_request_connection.execute as Function)({toolkit:slug,reason:'Use app'},{toolCallId:'hidden',messages:[]}),/not available in Dash/);
 }
 assert.equal((await f.store.getSnapshot(f.run.id))?.actions.length,0);
 for(const slug of ['twitter','box','railway','salesforce','zoom']) assert.equal(isAdditionalConnector(slug),true,slug);
});

test('connector accounts hide anonymous expired attempts without merging identified accounts',()=>{
 const active={status:'ACTIVE',alias:null}; const expired={status:'EXPIRED',alias:null};
 assert.deepEqual(visibleConnectorAccounts([active,expired,expired,expired,expired]),[active]);
 assert.deepEqual(visibleConnectorAccounts([expired,expired]),[expired]);
 const other={status:'EXPIRED',alias:'Other account'};
 assert.deepEqual(visibleConnectorAccounts([active,other,expired]),[active,other]);
 assert.deepEqual(visibleConnectorAccounts([{status:'FAILED',alias:null}]),[]);
});
