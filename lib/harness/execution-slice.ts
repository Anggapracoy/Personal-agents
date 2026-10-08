import { AsyncLocalStorage } from 'node:async_hooks';
const slice = new AsyncLocalStorage<number>();
export class ExecutionSliceYield extends Error {}
export function executionSliceDue() { const deadline = slice.getStore(); return deadline !== undefined && Date.now() >= deadline; }
export function withExecutionSlice<T>(deadline: number, work: () => Promise<T>) { return slice.run(deadline, work); }
