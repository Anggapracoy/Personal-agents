import assert from "node:assert/strict";
import test from "node:test";
import { questionSummary, interactionSummary, includeAnsweredQuestions } from "../lib/harness/question-summary";
import { threadItems } from "../lib/harness/thread";
import { MemoryRunStore } from "../lib/harness/store";
import type { AgentAction } from "../lib/harness/types";
const action: AgentAction = { id: "q1", runId: "run", stepId: null, toolName: "ask_questions", risk: "read", preview: "Question", approvedAt: null, approvedBy: null, status: "executed", executedAt: "2026-09-10T01:01:00Z", input: { questions: [
  { id: "day", question: "Which evenings?", answerType: "multiple_choice", options: [{ id: "thu", label: "Thursday" }, { id: "fri", label: "Friday" }] },
  { id: "code", question: "Verification code?", answerType: "secret", options: [] },
] }, result: { responses: [{ questionId: "day", answerType: "multiple_choice", selectedOptionIds: ["thu", "fri"], text: null }, { questionId: "code", answerType: "secret", secretKey: "private-key", text: "never-display-me" }] } };
test('every answered handoff has a safe, specific inline receipt', () => {
  for (const [toolName, label] of [['vault_request_item', 'Login details'], ['vault_fill_login', 'Saved login'], ['vault_fill_payment', 'Saved card'], ['browser_request_signin', 'Sign-in'], ['browser_request_takeover', 'Browser step'], ['google_request_reconnect', 'Google account'], ['gmail_send_draft', 'Email']]) {
    const answered = { ...action, toolName, approvedBy: 'user', input: { kind: 'login', password: 'private-password', pageUrl: 'https://secret@example.com/path?token=private-token' }, result: { snapshot: 'private-snapshot', title: 'Rainier Tuesday' } };
    const summary = interactionSummary(answered)!;
    assert.equal(summary.answers[0].question, label);
    assert.equal(summary.compact, true);
    assert.ok(!JSON.stringify(summary).includes('private-'));
    assert.ok(!JSON.stringify(summary).includes('Rainier Tuesday'));
    assert.equal(interactionSummary({ ...answered, status: 'proposed', approvedBy: null }), null);
    assert.equal(interactionSummary({ ...answered, status: 'rejected', result: { userSkipped: true } })!.answers[0].answer, 'Skipped');
    assert.equal(interactionSummary({ ...answered, status: 'failed' })!.answers[0].answer, 'Couldn’t finish');
  }
  assert.equal(interactionSummary({ ...action, toolName: 'browser_click' }), null);
});
test('credential responses survive reopening and snapshot updates without duplication', async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: 'test', decisionId: null, title: 'Rainier Tuesday', category: 'social', request: 'Plan a visit', metadata: {} });
  const snapshot = (await store.getSnapshot(run.id))!;
  snapshot.actions = [{ ...action, toolName: 'vault_request_item', input: { kind: 'login' }, result: { vaultUpdated: true } }];
  const receipt = threadItems(snapshot, []);
  assert.deepEqual(receipt.map(item => item.kind), ['answers']);
  assert.deepEqual(includeAnsweredQuestions(receipt, snapshot.actions), receipt);
  assert.ok(!JSON.stringify(receipt).includes(snapshot.title));
});
test("answered groups show labels and redact secret values and references", () => {
  const result = questionSummary(action)!;
  assert.deepEqual(result.answers.map(a => a.answer), ["Thursday, Friday", "Secure answer provided"]);
  assert.ok(!JSON.stringify(result).includes("private-key"));
  assert.ok(!JSON.stringify(result).includes("never-display-me"));
  assert.equal(questionSummary({ ...action, status: "proposed" }), null);
  assert.equal(questionSummary({ ...action, result: { responses: [] } }), null);
});
test("snapshot fallback inserts summaries before later messages and never duplicates", () => {
  const messages = [{ id: "before", createdAt: "2026-09-10T01:00:00Z" }, { id: "after", createdAt: "2026-09-10T01:02:00Z" }];
  const result = includeAnsweredQuestions(messages, [action]);
  assert.deepEqual(result.map(a => a.id), ["before", "answers:q1", "after"]);
  assert.deepEqual(includeAnsweredQuestions(result, [action]), result);
});
test("completed transcripts retain answers whether the SDK saved the tool call or not", async () => {
  const store = new MemoryRunStore();
  const run = await store.createRun({ userId: "test", decisionId: null, title: "Test", category: "social", request: "Plan dinner", metadata: {} });
  const snapshot = (await store.getSnapshot(run.id))!;
  snapshot.actions = [action]; snapshot.status = "done";
  const message = { id: "msg", runId: run.id, seq: 1, createdAt: "2026-09-10T01:00:00Z", message: { role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: "q", toolName: "ask_questions", input: action.input }] } };
  assert.deepEqual(threadItems(snapshot, [message]).map(i => i.kind), ["answers"]);
  assert.deepEqual(threadItems(snapshot, []).map(i => i.kind), ["answers"]);
});
test("stale cached answers move back between the actual surrounding messages", () => {
  const before = { id: "before", createdAt: "2026-09-10T01:00:00.000Z" };
  const after = { id: "after", createdAt: "2026-09-10T01:02:00.000Z" };
  const result = includeAnsweredQuestions([questionSummary(action)!, before, after], [action]);
  assert.deepEqual(result.map(item => item.id), ["before", "answers:q1", "after"]);
  assert.deepEqual(includeAnsweredQuestions(result, [action]), result);
});
test("answer chronology compares instants across timezone and precision formats", () => {
  const messages = [{ id: "before", createdAt: "2026-09-10T02:00:00+01:00" }, { id: "after", createdAt: "2026-09-09T21:02:00-04:00" }];
  assert.deepEqual(includeAnsweredQuestions(messages, [action]).map(item => item.id), ["before", "answers:q1", "after"]);
});

test('generic approved actions never add receipts and stale cached receipts are removed', () => {
  const approved = { ...action, toolName: 'device_get_location', approvedBy: 'user', input: {}, result: {} };
  assert.equal(interactionSummary(approved), null);
  const cached = { id: `answers:${approved.id}`, kind: 'answers' as const, compact: true, answers: [{ question: 'Requested action', answer: 'Approved' }] };
  assert.deepEqual(includeAnsweredQuestions([cached], [approved]), []);
});

test('email deletion history removes false payment receipts and retains the single login', () => {
  const login: AgentAction = { ...action, id: 'login', toolName: 'vault_request_item', approvedBy: 'user', input: { kind: 'login', pageUrl: 'https://accounts.google.com' }, result: { selectedItem: { label: 'Google', usernameHint: 'mi•••@gmail.com' } } };
  const deletions: AgentAction[] = ['batch-delete', 'single-delete'].map(id => ({ ...action, id, toolName: 'browser_click', approvedBy: 'user', input: { elementName: 'Delete', approvalType: 'payment', pageUrl: 'https://mail.google.com', requiresApproval: true }, result: {} }));
  const cached = deletions.map(item => ({ id: `answers:${item.id}`, kind: 'answers' as const, answers: [{ question: 'Payment', answer: 'Approved' }] }));
  const projected = includeAnsweredQuestions(cached, [login, ...deletions]);
  assert.deepEqual(projected.map(item => item.id), ['answers:login']);
  assert.equal(interactionSummary(login)?.signin?.status, 'Unlocked securely');
  assert.deepEqual(includeAnsweredQuestions(projected, [login, ...deletions]), projected);
});

test('vault receipts show only the selected safe metadata and mask card digits', () => {
  const selected = { ...action, toolName: 'vault_request_item', input: { kind: 'payment_card' }, result: { selectedItem: { kind: 'payment_card', label: 'Personal card', cardBrand: 'Visa', cardLast4: '4242', cardNumber: 'never-expose', securityCode: 'never-expose' } } };
  assert.deepEqual(interactionSummary(selected)?.vault, { kind: 'payment_card', label: 'Personal card', detail: 'Visa •••• 4242' });
  assert.ok(!JSON.stringify(interactionSummary(selected)).includes('never-expose'));
  assert.equal(interactionSummary({ ...selected, status: 'failed' })?.vault, undefined);
  assert.equal(interactionSummary({ ...selected, result: { ...selected.result, userSkipped: true } })?.vault, undefined);
  const malformed = { ...selected, result: { selectedItem: { label: 'Card', cardLast4: '4242424242424242' } } };
  assert.ok(!JSON.stringify(interactionSummary(malformed)).includes('4242424242424242'));
  assert.deepEqual(interactionSummary({ ...selected, input: { kind: 'login' }, result: { selectedItem: { label: 'Nike', usernameHint: 'michael@example.com', password: 'never-expose' } } })?.vault, { kind: 'login', label: 'Nike', detail: 'michael@example.com' });
});

test('purchase receipts preserve the decision without claiming a completed order or leaking checkout URLs', () => {
  const purchase: AgentAction = { ...action, toolName: 'browser_click', approvedBy: 'user', input: { approvalCategory: 'purchase', pageUrl: 'https://private-user@example.com/checkout?token=private-token' }, result: {} };
  const summary = interactionSummary(purchase)!;
  assert.deepEqual(summary.purchase, { merchant: 'example.com' });
  assert.equal(summary.answers[0].answer, 'Approved');
  assert.ok(!JSON.stringify(summary).includes('private-'));
  assert.equal(interactionSummary({ ...purchase, status: 'rejected' })!.answers[0].answer, 'Declined');
  assert.equal(interactionSummary({ ...purchase, status: 'failed' })!.answers[0].answer, 'Couldn’t finish');
  assert.equal(interactionSummary({ ...purchase, status: 'proposed', approvedBy: null }), null);
});

test('bill and transfer approvals keep their own receipt headings', () => {
  for (const [approvalType, question] of [['bill_payment', 'Bill payment'], ['transfer', 'Transfer'], ['payment', 'Payment']] as const) {
    const financial: AgentAction = { ...action, toolName: 'browser_click', approvedBy: 'user', input: { approvalType, pageUrl: 'https://private-user@example.com/pay?token=private-token' }, result: {} };
    const summary = interactionSummary(financial)!;
    assert.equal(summary.answers[0].question, question);
    assert.equal(summary.purchase?.approvalType, approvalType);
    assert.equal(summary.purchase?.merchant, 'example.com');
    assert.ok(!JSON.stringify(summary).includes('private-'));
    assert.equal(interactionSummary({ ...financial, status: 'rejected' })?.answers[0].answer, 'Declined');
  }
});

test('sign-in receipts show site identity without exposing URLs or account identifiers', () => {
  const login={...action,toolName:'vault_request_item',input:{kind:'login',pageUrl:'https://dashboard.stripe.com/login?token=secret'},result:{selectedItem:{label:'Stripe',usernameHint:'michael@example.com'}},approvedBy:'user'};
  const summary=interactionSummary(login)!;
  assert.deepEqual(summary.signin,{host:'dashboard.stripe.com',detail:'mi•••@example.com',status:'Unlocked securely'});
  assert.ok(!JSON.stringify(summary.signin).includes('michael'));
  const handoff=interactionSummary({...login,toolName:'browser_request_signin',result:{sessionTransferred:true,observationPending:true}})!;
  assert.deepEqual(handoff.signin,{host:'dashboard.stripe.com',detail:'Browser session',status:'Session shared'});
});

test('older declined sign-in stays in place after replies and repeated refreshes', () => {
  const declined:AgentAction={...action,id:'old-signin',toolName:'browser_request_signin',input:{pageUrl:'https://vercel.com/login'},result:null,status:'rejected',approvedBy:null,approvedAt:null,executedAt:null,createdAt:'2026-09-23T03:51:07.842Z'};
  const items=[{id:'before',createdAt:'2026-09-23T03:50:00Z'},{id:'switch-to-stripe',createdAt:'2026-09-23T03:52:00Z'},{id:'sales',createdAt:'2026-09-23T04:01:00Z'}];
  const first=includeAnsweredQuestions(items,[declined]);
  assert.deepEqual(first.map(x=>x.id),['before','answers:old-signin','switch-to-stripe','sales']);
  const refreshed=includeAnsweredQuestions([...first,{id:'new-reply',createdAt:'2026-09-23T04:03:00Z'}],[declined]);
  assert.deepEqual(refreshed.map(x=>x.id),['before','answers:old-signin','switch-to-stripe','sales','new-reply']);
  assert.equal(interactionSummary({...declined,status:'executed',approvedBy:'user',approvedAt:'2026-09-23T03:53:00Z'})?.createdAt,'2026-09-23T03:53:00Z');
});

test('memory store preserves original request time after rejecting a pending action', async () => {
  const store=new MemoryRunStore();
  const pending=await store.createAction({runId:'rejected-history',stepId:null,toolName:'browser_request_signin',risk:'write_external',preview:'Sign in',input:{pageUrl:'https://example.com/login'}});
  assert.ok(Number.isFinite(Date.parse(pending.createdAt!)));
  await store.rejectPendingActions(pending.runId);
  const rejected=await store.getAction(pending.id,pending.runId);
  assert.equal(rejected?.createdAt,pending.createdAt);
  assert.equal(interactionSummary(rejected!)?.createdAt,pending.createdAt);
});

test('proactive chosen options stay structured while typed replies stay messages',async()=>{
 const store=new MemoryRunStore();const run=await store.createRun({userId:'choice@example.invalid',decisionId:'decision',category:'social',title:'Dinner',request:'Choose dinner',metadata:{sourceType:'email',chosenOption:'Book it',retryDecision:{title:'Dinner',subtitle:'Want me to book dinner?',options:[{id:'book',label:'Book it'},{id:'skip',label:'Skip'}]}}});
 await store.appendMessages(run.id,[{role:'user',content:'Choose dinner'}]);let snapshot=(await store.getSnapshot(run.id))!;
 const items=threadItems(snapshot,await store.listMessages(run.id));assert.equal(items.filter(item=>item.kind==='user').length,0);const receipt=items.find(item=>item.kind==='answers');assert.equal(receipt?.kind,'answers');if(receipt?.kind==='answers')assert.deepEqual(receipt.answers[0].selectedOptions,[{label:'Book it'}]);
 await store.updateRunMetadata(run.id,{customInstruction:'Try tomorrow'});snapshot=(await store.getSnapshot(run.id))!;assert.equal(threadItems(snapshot,await store.listMessages(run.id)).some(item=>item.kind==='user'),true);
});
