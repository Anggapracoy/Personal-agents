import { getDiscoveryScanState, rememberReviewedMessages } from '../lib/discovery/scan-state';
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { addCandidates, knownDedupeKeys, removeDecisions } from '../lib/proactive/engine/store';
import { getDb } from '../db';
import { getWorkspaceState } from '../lib/workspace-state';

const url = process.env.PROACTIVE_TEST_DATABASE_URL;
test('resolution survives retry, retires notifications, and preserves started cards; watch upgrade is idempotent', {skip:!url}, async () => {
  // This suite only runs on an explicitly supplied disposable local database.
  assert.ok(url!.includes('127.0.0.1') || url!.includes('localhost'));
  process.env.DATABASE_URL = url;
  const client = postgres(url!, { onnotice: () => {} });
  try {
    for (const migration of ['0002_agent_harness.sql','0005_connected_google_accounts.sql','0006_workspace_states.sql','0008_google_push_watches.sql','0024_proactive_engine.sql','0025_google_sent_watch.sql','0025_google_sent_watch.sql']) {
      await client.unsafe(readFileSync(`db/migrations/${migration}`, 'utf8'));
    }
    const owner = 'events@example.invalid';
    const scanKey = `${owner}:connection`;
    await rememberReviewedMessages(scanKey, ['sent'], [], '5');
    assert.equal(await getDiscoveryScanState(`${scanKey}:google-events`), null, 'manual review is not an event acknowledgement');
    await rememberReviewedMessages(`${scanKey}:google-events`, ['sent'], [], '5');
    await rememberReviewedMessages(scanKey, ['incoming'], [], '6');
    assert.deepEqual((await getDiscoveryScanState(`${scanKey}:google-events`))?.reviewedMessageIds, ['sent']);
    assert.deepEqual((await getDiscoveryScanState(scanKey))?.reviewedMessageIds, ['sent','incoming']);
    const decisions = [{id:'handled',title:'Reply',options:[]}, {id:'started',title:'Active',options:[],activeRunId:'already-running'}];
    await client`insert into workspace_states(owner_email,state_json,preferences_json) values (${owner},${JSON.stringify({decisions,tasks:[],history:[],discardedDecisionIds:[]})}::jsonb,'{}')`;
    const candidate = {kind:'loop_owed',dedupeKey:'thread:message',tier:'natural' as const,title:'Reply',body:'Reply',decisionId:'handled'};
    await Promise.all([addCandidates(owner,[candidate]),addCandidates(owner,[candidate])]);
    assert.equal((await client`select * from proactive_candidates`).length,1,'concurrent retries cannot duplicate a candidate');
    assert.equal((await knownDedupeKeys(owner,['thread:message'])).size,1);
    await addCandidates(owner,[{...candidate,dedupeKey:'started',decisionId:'started'}]);
    assert.equal(await removeDecisions(owner,['handled','started']),1);
    assert.equal(await removeDecisions(owner,['handled','started']),0,'retry is safe');
    assert.deepEqual((await getWorkspaceState(owner)).state.decisions.map(d=>d.id),['started']);
    const rows = await client`select decision_id,status from proactive_candidates order by decision_id`;
    assert.deepEqual(rows.map(r=>[r.decision_id,r.status]),[['handled','resolved'],['started','pending']]);
    const [column] = await client`select column_default from information_schema.columns where table_name='google_source_watches' and column_name='gmail_watch_version'`;
    assert.equal(column.column_default,'1','existing inbox-only watches are marked for upgrade');
  } finally { await getDb().$client.end(); await client.end(); }
});
