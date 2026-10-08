import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { PostgresRunStore } from '../lib/harness/store';

const url = process.env.ARTIFACT_SNAPSHOT_TEST_DATABASE_URL;
test('snapshot preserves artifact metadata and latest-name ordering without fetching bytes; explicit downloads retain bytes', { skip: !url }, async () => {
  if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('Dedicated local database required');
  const queries: string[] = [];
  const sql = postgres(url, { max: 1, debug: (_connection, query) => queries.push(query) });
  const store = new PostgresRunStore(url, sql);
  const run = await store.createRun({ userId: 'artifact-test@example.invalid', decisionId: null, category: 'test', title: 'Artifacts', request: 'test', metadata: {} });
  try {
    const bytes = Buffer.alloc(1024 * 1024, 117).toString('base64');
    const old = await store.createArtifact({ runId: run.id, actionId: null, name: 'Frame.PNG', mimeType: 'image/png', bytesBase64: bytes });
    const other = await store.createArtifact({ runId: run.id, actionId: null, name: 'notes.txt', mimeType: 'text/plain', bytesBase64: Buffer.from('notes').toString('base64') });
    const latest = await store.createArtifact({ runId: run.id, actionId: null, name: 'frame.png', mimeType: 'image/png', bytesBase64: bytes });
    // Explicit timestamps avoid relying on database clock resolution for capture order.
    for (const [index, artifact] of [old, other, latest].entries()) await sql`update agent_artifacts set created_at=timestamp '2026-01-01' + ${index} * interval '1 second' where id=${artifact.id}`;
    queries.length = 0;
    const snapshot = (await store.getSnapshot(run.id))!;
    assert.deepEqual(snapshot.artifacts.map(a => a.id), [other.id, latest.id]);
    const artifactQuery = queries.find(q => q.includes('from agent_artifacts'))!;
    assert.ok(artifactQuery);
    assert.doesNotMatch(artifactQuery, /\bcontent\b|select\s+\*/i);
    assert.ok(snapshot.artifacts.every(a => !('bytesBase64' in a)));
    for (const artifact of snapshot.artifacts) {
      const { bytesBase64, ...metadata } = (await store.getArtifact(artifact.id, run.id))!;
      assert.deepEqual(artifact, metadata);
      assert.equal(bytesBase64, artifact.id === latest.id ? bytes : other.bytesBase64);
    }
    assert.equal(await store.getArtifact(latest.id, crypto.randomUUID()), null);
    assert.equal(await store.getSnapshot(crypto.randomUUID()), null);
  } finally { await sql`delete from agent_runs where id=${run.id}`; await sql.end(); }
});
