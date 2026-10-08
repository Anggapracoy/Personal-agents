import assert from 'node:assert/strict';
import test from 'node:test';
import {groupBillingEvidence} from '../lib/discovery/billing-evidence';
import {queueDecisionPushNotifications} from '../lib/push-notifications';
import type {DecisionEmailInput} from '../lib/agent';
import type {DiscoveryCandidate} from '../lib/discovery/types';

const when='Wed, 30 Sep 2026 21:26:26 -0400';
function email(id:string,overrides:Partial<DecisionEmailInput>={}):DecisionEmailInput{
 return {id,threadId:id,subject:'Payment failed for your organization',from:'Acme team <updates@acme.example>',to:'user@example.invalid',date:when,
 snippet:'',body:'Unable to process payment for the latest invoice. The organization will be downgraded.',
 links:['https://app.acme.example/billing','https://invoice.processor.example/i/acct_Example123/invoice'],attachments:[],confirmationNumbers:[],...overrides};
}
const stripe=email('charge',{from:'Acme Inc <failed-payments+acct_Example123@processor.example>',subject:'$271.30 payment to Acme was unsuccessful',
 body:'Unable to charge your card for the subscription.',links:['https://app.acme.example/settings/billing?referer=failed_payment']});
const provider=email('downgrade');
function candidate(id:string):DiscoveryCandidate{return {id,situationKey:`different-thread:${id}`,signalType:'invoice',summary:id,emailIds:[id],potentialValue:80,triggerFacts:[id],researchQuestions:[]};}

test('fake processor/provider flow sends one notification from one combined investigation',async()=>{
 const groups=groupBillingEvidence([candidate('charge'),candidate('downgrade')],[stripe,provider]);
 assert.equal(groups.length,1);assert.deepEqual(new Set(groups[0]!.emailIds),new Set(['charge','downgrade']));
 let investigations=0;
 const cards=groups.map(g=>{investigations++;return {id:g.id,title:'Acme billing',subtitle:'The $271.30 payment failed; the organization may downgrade.'};});
 const jobs:any[]=[];
 const db:any={execute:async()=>[{archived:false}],transaction:async(work:any)=>work(db),insert:()=>({values:(rows:any[])=>{jobs.push(...rows);return {onConflictDoNothing:()=>({returning:async()=>[{id:'queued'}]})};}})};
 await queueDecisionPushNotifications('test@example.invalid',cards as any,db);
 assert.equal(investigations,1);assert.equal(cards.length,1);assert.equal(jobs.length,1);assert.match(jobs[0].body,/271.30/);
});

test('equivalent timezone timestamps group; even one second apart does not',()=>{
 assert.equal(groupBillingEvidence([candidate('charge'),candidate('downgrade')],[stripe,{...provider,date:'2026-10-01T01:26:26Z'}]).length,1);
 assert.equal(groupBillingEvidence([candidate('charge'),candidate('downgrade')],[stripe,{...provider,date:'2026-10-01T01:26:27Z'}]).length,2);
});

test('distinct invoices and amounts remain separate at the same timestamp',()=>{
 for(const [a,b]of [
  [email('a',{body:'Unable to process payment for invoice #INV-1001.'}),email('b',{body:'Unable to process payment for invoice #INV-1002.'})],
  [email('a',{subject:'$10.00 payment failed'}),email('b',{subject:'$20.00 payment failed'})],
 ] as const)assert.equal(groupBillingEvidence([candidate('a'),candidate('b')],[a,b]).length,2);
});

test('same time alone never groups unrelated providers or different accounts',()=>{
 assert.equal(groupBillingEvidence([candidate('charge'),candidate('downgrade')],[stripe,{...provider,links:['https://app.other.example/billing','https://invoice.processor.example/i/acct_Example123/invoice']}]).length,2);
 assert.equal(groupBillingEvidence([candidate('charge'),candidate('downgrade')],[stripe,{...provider,links:['https://app.acme.example/billing','https://invoice.processor.example/i/acct_Different123/invoice']}]).length,2);
});

test('an unspecific notice cannot bridge two distinct invoices',()=>{
 const sources=[email('a',{body:'Unable to process payment for invoice #INV-1001.'}),email('b',{body:'Unable to process payment for invoice #INV-1002.'}),email('unknown')];
 assert.equal(groupBillingEvidence(sources.map(s=>candidate(s.id)),sources).length,3);
});
