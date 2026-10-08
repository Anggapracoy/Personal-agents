/** Two difficult live-harness tasks across Muse medium/high and Terra medium. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createAgentModel } from '../lib/harness/model';
import { runAgent } from '../lib/harness/run';
import { MemoryRunStore } from '../lib/harness/store';
import { closeCloudBrowser } from '../lib/harness/browser/registry';

if (!process.env.MUSE_TEST_DATABASE_URL || new URL(process.env.MUSE_TEST_DATABASE_URL).hostname !== '127.0.0.1') throw new Error('An isolated local MUSE_TEST_DATABASE_URL is required');
process.env.DATABASE_URL = process.env.MUSE_TEST_DATABASE_URL;
delete process.env.INNGEST_EVENT_KEY;
const task = process.argv[2];
if (!['browser','calendar'].includes(task)) throw new Error('Choose browser or calendar');
const configs = [{provider:'meta',modelId:'muse-spark-1.3',effort:'medium'}, {provider:'meta',modelId:'muse-spark-1.3',effort:'high'}, {provider:'openai',modelId:'gpt-5.6-terra',effort:'medium'}] as const;
const browserPrompt = `Perform a careful shopping audit using the Browserless cloud browser. Starting at https://www.keychron.com/collections/low-profile-keyboard-collection, discover three distinct low-profile wireless keyboard models at or below $160 USD. Open each direct product page and verify a concrete currently selected variant: exact product name, variant label, displayed USD price, numeric layout percentage, evidence of wireless connectivity, and the selected variant's exact availability/purchase-control text. A sold-out variant must not be called available; a collection's 'from' price is not sufficient evidence of the selected variant's price. If no three qualifying models can be verified, say so rather than inventing data.
Use sandbox_run to produce /workspace/out/shopping-audit.json and /workspace/out/shopping-report.md. JSON must have products (exactly three objects with name, variant, priceUSD, layoutPercent, wireless, available, availabilityLabel, url, evidenceQuotes, score) and winnerUrl. Each evidenceQuotes value is an array of short exact page-text quotes supporting the claims. Score each product as max(0,40-priceUSD/4) + (wireless?25:0) + (layoutPercent<=75?20:10) + (available?15:0). Rank descending, with lower price breaking a score tie, then URL alphabetical. Independently recompute and verify the scores using code. The report should explain which variant wins and include all source URLs. Reopen the winning product's direct URL and capture it as shopping-winner.png. Return a structured verified result with the artifacts and source links. Use browser tools for all web research; sandbox only for calculation/artifacts, not fetching product information. Do not buy, submit, log in, or write to any external account.`;
const calendarPrompt = `This is a synthetic-calendar scheduling evaluation. Use calendar_search_events and calendar_get_event on the connected test calendar to inspect all events covering 2026-10-30 through 2026-11-03. Recurrences are already expanded by the calendar API. Do not use Gmail or browse the web. Propose a schedule only; do not create, update, delete, send, or invite.
Schedule three blocks on working dates Friday Oct 30, Monday Nov 2, or Tuesday Nov 3, 2026, within 09:00-17:00 America/Toronto, with starts on 15-minute boundaries:
1. Prep: 90 uninterrupted minutes, ending at least 30 minutes before kickoff; it may be on an earlier working date.
2. Kickoff: 60 uninterrupted minutes, with Alice available 09:00-17:00 Europe/London and Bob 08:00-17:00 America/Los_Angeles. Respect actual IANA timezone offsets on each date, including the daylight-saving transition.
3. Follow-up: 45 uninterrupted minutes on the SAME date as kickoff, starting at least 60 minutes after kickoff ends.
Treat confirmed and tentative opaque events as busy, including all-day opaque events. Ignore cancelled events, transparent events, and events where the self attendee declined. Keep a 15-minute buffer before and after every existing timed busy event. Proposed blocks must not overlap one another. Lunch is blocked daily 12:30-13:00 Toronto with no additional buffer. No weekend work.
Optimize lexicographically: earliest feasible kickoff; then latest feasible prep ending at least 30 minutes before it; then earliest feasible follow-up. Search the full allowed date range before deciding. Read individual event details for the recurring Friday and Monday morning events and for any declined/transparent/cancelled events whose status affects your chosen plan.
Use sandbox_run to exhaustively enumerate slots and independently check every constraint. Produce /workspace/out/calendar-plan.json with prep, kickoff, followup (each {start,end} as ISO timestamps with offsets), kickoffLondon {start,end}, kickoffLosAngeles {start,end}, ignoredEventIds, and blockingEventIds. Also create /workspace/out/calendar-plan.ics with precisely these three proposed events, UTC timestamps, no ATTENDEE or ORGANIZER lines, and /workspace/out/calendar-proof.md explaining why no earlier kickoff works, which events were ignored, and how DST changes London availability. Return these artifacts and a concise proposal, explicitly saying nothing was added to the calendar.`;
const event = (id: string, summary: string, start: string, end: string, extras: Record<string,unknown> = {}) => ({id,summary,status:'confirmed',transparency:'opaque',start:{dateTime:start,timeZone:'America/Toronto'},end:{dateTime:end,timeZone:'America/Toronto'},...extras});
const events = [
 event('fri-recurring','Morning standup','2026-10-30T09:00:00-04:00','2026-10-30T10:00:00-04:00',{recurringEventId:'morning-series'}),
 event('fri-review','Design review','2026-10-30T11:00:00-04:00','2026-10-30T11:30:00-04:00',{status:'tentative'}),
 event('fri-client','Client call','2026-10-30T13:30:00-04:00','2026-10-30T14:30:00-04:00'),
 event('fri-wrap','Wrap up','2026-10-30T16:30:00-04:00','2026-10-30T17:00:00-04:00'),
 event('fri-declined','Optional training','2026-10-30T14:45:00-04:00','2026-10-30T16:15:00-04:00',{attendees:[{email:'synthetic@example.invalid',self:true,responseStatus:'declined'}]}),
 event('mon-recurring','Morning standup','2026-11-02T10:00:00-05:00','2026-11-02T10:45:00-05:00',{recurringEventId:'morning-series'}),
 event('mon-client','Client call','2026-11-02T12:30:00-05:00','2026-11-02T13:30:00-05:00'),
 event('mon-review','Design review','2026-11-02T14:45:00-05:00','2026-11-02T15:30:00-05:00'),
 event('mon-transparent','FYI working location','2026-11-02T11:00:00-05:00','2026-11-02T12:30:00-05:00',{transparency:'transparent'}),
 event('mon-cancelled','Cancelled appointment','2026-11-02T13:45:00-05:00','2026-11-02T14:30:00-05:00',{status:'cancelled'}),
 {id:'tue-offsite',summary:'Offsite',status:'confirmed',transparency:'opaque',start:{date:'2026-11-03'},end:{date:'2026-11-04'}},
 {id:'fri-fyi',summary:'FYI launch day',status:'confirmed',transparency:'transparent',start:{date:'2026-10-30'},end:{date:'2026-10-31'}},
];
const originalFetch = globalThis.fetch;
const calendarReads: Array<{url:string;eventIds:string[]}> = [];
if(task === 'calendar') {
 globalThis.fetch = async (input,init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname.endsWith('googleapis.com')) {
   if ((init?.method ?? 'GET') !== 'GET' || !url.pathname.startsWith('/calendar/v3/calendars/primary/events')) throw new Error('Synthetic evaluation forbids non-calendar reads and all Google mutations');
   const id = url.pathname.split('/events/')[1];
   const picked = id ? events.filter(e=>e.id === decodeURIComponent(id)) : events.filter(e=> {
    const start = Date.parse('dateTime' in e.start ? e.start.dateTime as string : e.start.date+'T00:00:00-05:00');
    const end = Date.parse('dateTime' in e.end ? e.end.dateTime as string : e.end.date+'T00:00:00-05:00');
    return end > Date.parse(url.searchParams.get('timeMin')!) && start < Date.parse(url.searchParams.get('timeMax')!) && (!url.searchParams.get('q') || e.summary.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()));
   });
   calendarReads.push({url:url.toString(),eventIds:picked.map(e=>e.id)});
   return Response.json(id ? picked[0] ?? {error:{message:'Not found'}} : {kind:'calendar#events',timeZone:'America/Toronto',items:picked.slice(0,Number(url.searchParams.get('maxResults') ?? 20))}, {status:id && !picked.length?404:200});
  }
  return originalFetch(input,init);
 };
}
const results: unknown[] = [];
const outputRoot = process.env.MUSE_EVAL_OUTPUT_ROOT ?? "artifacts/muse-hard";
for (const config of configs) {
 if (process.env.MUSE_EVAL_CONFIG && `${config.modelId}-${config.effort}` !== process.env.MUSE_EVAL_CONFIG) continue;
 const label = `${config.modelId}-${config.effort}`;
 const folder = `${outputRoot}/${task}/${label}`; mkdirSync(folder,{recursive:true});
 calendarReads.length=0;
 const store = new MemoryRunStore();
 const run=await store.createRun({userId:`hard-eval-${crypto.randomUUID()}@example.invalid`,decisionId:null,category:'evaluation',title:`${task}-${label}`,request:task==='browser'?browserPrompt:calendarPrompt,metadata:{modelProvider:config.provider,modelId:config.modelId,reasoningEffort:config.effort,userTimeZone:'America/Toronto'}});
 if(task==='calendar') await store.putSecret(run.id,'google_access_token','synthetic-calendar-token-not-a-real-credential');
 const started=performance.now();
 const timer=setInterval(async()=>{const s=await store.getSnapshot(run.id);if(s){writeFileSync(`${folder}/progress.json`,JSON.stringify({elapsedMs:performance.now()-started,status:s.status,response:s.response,actions:s.actions},null,2)); console.log('PROGRESS',label,Math.round((performance.now()-started)/1000),s.status,s.actions.length,s.actions.at(-1)?.toolName)}},15000);
 try { await runAgent({store,runId:run.id,model:createAgentModel(store, { useGlobalSettings: false }),signal:AbortSignal.timeout(12*60_000)}); } finally {clearInterval(timer);}
 const elapsedMs=performance.now()-started;
 const s=(await store.getSnapshot(run.id))!;
 for(const a of s.artifacts){const stored=await store.getArtifact(a.id,s.id);if(stored)writeFileSync(`${folder}/${a.name.replaceAll('/','_')}`,Buffer.from(stored.bytesBase64,'base64'));}
 const requests=(s.metadata[config.provider==='meta'?'metaRequests':'openaiRequests']??[]) as Array<Record<string,number>>;
 const estimatedCostUSD=requests.length?requests.reduce((total,r)=>{const i=r.inputTokens??0,o=r.outputTokens??0,c=r.cacheReadTokens??0,w=r.cacheWriteTokens??0;return total+(config.provider==='meta'?(i-c)*1.25+c*.15+o*4.25:(i-c-w)*2+c*.2+w*2.5+o*12)/1e6},0):null;
 const row={task,...config,elapsedMs,estimatedModelCostUSD:estimatedCostUSD,status:s.status,error:s.error,response:s.response,result:s.result,requests,actions:s.actions,artifacts:s.artifacts,calendarReads:[...calendarReads]};
 writeFileSync(`${folder}/result.json`,JSON.stringify(row,null,2));
 writeFileSync(`${folder}/messages.json`,JSON.stringify(await store.listMessages(run.id),null,2));
 results.push(row);writeFileSync(`${outputRoot}/${task}/results.json`,JSON.stringify(results,null,2));
 console.log('HARD_RESULT',JSON.stringify({task,...config,elapsedMs,status:s.status,error:s.error,estimatedModelCostUSD:estimatedCostUSD,actions:s.actions.length,artifacts:s.artifacts.map(a=>a.name)}));
 await closeCloudBrowser(run.userId);
}
process.exit(0);
