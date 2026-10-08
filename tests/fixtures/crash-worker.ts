import { PostgresRunStore } from '../../lib/harness/store';
import { runAgent } from '../../lib/harness/run';
import { executeGuardedAction } from '../../lib/harness/actions';
import { ExecutionSliceYield } from '../../lib/harness/execution-slice';
const store = new PostgresRunStore(process.env.DATABASE_URL!);
const runId = process.env.TEST_RUN_ID!;
const mode = process.env.TEST_CRASH_MODE;
const halt = async () => { process.send?.('kill-ready'); await new Promise(() => {}); };
await runAgent({ runId, store, model: { async turn({ turnId }) {
  try {
    await executeGuardedAction({ runId, store, stepId: turnId, toolName: 'test_record', risk: 'write_external', preview: 'Record test item', args: { key: runId },
      execute: async () => {
        const receipt = await (await fetch(process.env.TEST_LEDGER_URL!, { method: 'POST', body: runId })).json();
        if (mode === 'during') await halt();
        return receipt;
      },
    });
  } catch (error) {
    if (mode !== 'resume' || !String(error).includes('outcome was not saved')) throw error;
    // Reconcile an ambiguous external result by reading the source, never repeating POST.
    const receipt = await (await fetch(`${process.env.TEST_LEDGER_URL!}?key=${runId}`)).json();
    if (!receipt.ok) throw Error('External result missing');
  }
  if (mode === 'after') await halt();
  if (mode === 'yield') throw new ExecutionSliceYield();
  await store.appendMessages(runId, [{ role: 'assistant', content: 'Completed the requested work.' }]);
  await store.updateRun(runId, { response: 'Completed the requested work.' });
} } });
await store.sql.end();
process.exit(0);
