/** Fix model choices during full-task runtime comparisons; never used by the app. */
import { readFileSync, writeFileSync } from 'node:fs';
type Entry = { status: number; headers: Record<string, string>; body: string };
export function modelCassette() {
  const path = process.env.BROWSER_MODEL_CASSETTE;
  const replay = process.env.BROWSER_MODEL_REPLAY === '1';
  if (!path) return { finish: async () => {} };
  const timingPath = process.env.BROWSER_MODEL_REPLAY_TIMINGS;
  const timings: number[] | null = timingPath ? JSON.parse(readFileSync(timingPath, 'utf8')).requests.map((r: { responseTimeMs: number }) => r.responseTimeMs) : null;
  const original = globalThis.fetch;
  const entries: Entry[] = replay ? JSON.parse(readFileSync(path, 'utf8')) : [];
  const pending: Promise<void>[] = [];
  let index = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.openai.com/')) return original(input, init);
    const position = index++;
    if (replay) {
      const entry = entries[position];
      if (!entry) throw new Error(`Model replay exhausted at request ${position}`);
      if (timings) {
        if (!Number.isFinite(timings[position])) throw new Error('Missing recorded model timing');
        await new Promise(resolve => setTimeout(resolve, timings[position]));
      }
      return new Response(entry.body, { status: entry.status, headers: entry.headers });
    }
    const response = await original(input, init);
    pending.push(response.clone().text().then(body => { entries[position] = { body, status: response.status, headers: Object.fromEntries(response.headers) }; }));
    return response;
  };
  return { finish: async () => {
    globalThis.fetch = original;
    await Promise.all(pending);
    if (replay && index !== entries.length) throw new Error(`Replay consumed ${index}/${entries.length} responses`);
    if (!replay) writeFileSync(path, JSON.stringify(entries), { mode: 0o600 });
  } };
}
