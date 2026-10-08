import { mutedByPreferences } from '../lib/proactive/engine/rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { recordFeedback, getPreferences } from '../lib/proactive/engine/store';
import { optionNeedsNoAgent } from '../app/workspace-model';

test('model-written dismissal labels use their action type rather than their wording', () => {
 for (const label of ['Keep it', 'Already handled', 'Stay in instead', 'No thanks']) {
  assert.equal(optionNeedsNoAgent({id:'decline',label,actionType:'no_action'}),true);
 }
 assert.equal(optionNeedsNoAgent({id:'act',label:'Cancel it',actionType:'approval'}),false);
 assert.equal(optionNeedsNoAgent({id:'legacy',label:'Keep it',actionType:'instant'}),true);
});

test('feedback persists from empty preferences, accumulates concurrently, and isolates users and mutes', { skip: !process.env.RECOVERY_TEST_DATABASE_URL }, async () => {
 const client = postgres(process.env.RECOVERY_TEST_DATABASE_URL!, { max: 8 });
 try {
  await client.unsafe(readFileSync(new URL('../db/migrations/0024_proactive_engine.sql', import.meta.url), 'utf8'));
  const db = drizzle(client);
  const owner = 'feedback-test@example.invalid';
  await recordFeedback(owner, {kind:'dismissed',category:'shopping'}, db);
  assert.deepEqual((await getPreferences(owner,db)).categoryFeedback.shopping, {yes:0,no:1});
  await Promise.all(Array.from({length:4}, () => recordFeedback(owner,{kind:'dismissed',category:'shopping'},db)));
  let prefs = await getPreferences(owner,db);
  await Promise.all(Array.from({length:5}, () => recordFeedback(owner,{kind:'accepted',category:'shopping'},db)));
  prefs = await getPreferences(owner,db);
  assert.deepEqual(prefs.categoryFeedback.shopping,{yes:5,no:5});
  await recordFeedback(owner,{kind:'accepted',category:'travel'},db);
  await recordFeedback(owner,{kind:'less_like_this',category:'shopping',topic:'shopping:store'},db);
  await recordFeedback(owner,{kind:'less_like_this',category:'shopping',topic:'shopping:store'},db);
  await recordFeedback(owner,{kind:'mute_sender',sender:'NEWS@EXAMPLE.INVALID',category:'shopping'},db);
  await recordFeedback(owner,{kind:'mute_sender',sender:'news@example.invalid'},db);
  prefs = await getPreferences(owner,db);
  assert.deepEqual(prefs.categoryFeedback,{shopping:{yes:5,no:7},travel:{yes:1,no:0}});
  assert.deepEqual(prefs.mutedTopics,['shopping:store']);
  assert.deepEqual(prefs.mutedSenders,['news@example.invalid']);
  assert.equal(mutedByPreferences({category:'shopping',sourceLabel:'Store'},prefs),true);
  assert.equal(mutedByPreferences({category:'travel',sourceLabel:'Store'},prefs),false);
  assert.deepEqual((await getPreferences('other@example.invalid',db)).categoryFeedback,{});
 } finally { await client.end(); }
});
