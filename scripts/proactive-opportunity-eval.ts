/** Read-only model evaluation: synthetic inputs, no database, jobs or notifications. */
import assert from 'node:assert/strict';
import { generateText,Output } from 'ai';
import { morningReviewGuidance,morningReviewSchema,keepNovelMorningReviews,type MorningIdea } from '../lib/proactive/morning-ideas';
import type { MorningContext } from '../lib/proactive/morning-context';
import { openai } from '@ai-sdk/openai';
import { extractOpportunities } from '../lib/proactive/opportunity-model';
import { groundedOpportunity,type OpportunitySource } from '../lib/proactive/opportunities';
const now=new Date();
const source=(id:string,request:string,outcome:string,result:OpportunitySource['result']):OpportunitySource=>({id,title:request,sourceType:'manual',status:'done',request,outcome,result,createdAt:new Date(now.getTime()-86400000).toISOString(),updatedAt:new Date(now.getTime()-86400000).toISOString(),userTurns:[{authored:true,text:request,at:new Date(now.getTime()-86400000).toISOString()}]});
const sources=[
 source('00000000-0000-4000-8000-000000000001','Find me a folding treadmill that is actually good for running.','The search ended without finding a suitable in-stock model.',{outcome:'completed',verified:true}),
 source('00000000-0000-4000-8000-000000000002','I’m going to Montreal next month for a concert. My train and hotel are already booked.','The trip itinerary is arranged.',{outcome:'completed',verified:true}),
 source('00000000-0000-4000-8000-000000000003','This is only a test of the shopping flow. Find skincare products.','Test completed.',{outcome:'completed',verified:true}),
 source('00000000-0000-4000-8000-000000000004','Do todays Wordle','Puzzle solved.',{outcome:'completed',verified:true}),
];
for(const [offset,index] of [[43,5],[22,6],[1,7]]) {
 const at=new Date(now.getTime()-offset*86400000).toISOString();
 const row=source(`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,'Order me three bags of SmartSweets peach rings.',`Ordered three bags of SmartSweets peach rings. Separate purchase SW10${index} is confirmed.`,{outcome:'completed',verified:true,externalChange:true});
 sources.push({...row,createdAt:at,updatedAt:at,userTurns:[{authored:true,text:row.request,at}]});
}
const steak=source('00000000-0000-4000-8000-000000000008','Get me a kosher steak tonight.','All suitable venues were closed; no steak was obtained.',{outcome:'completed',verified:true});
const pastDate=new Date(now.getTime()-3*86400000).toISOString().slice(0,10);
const cake=source('00000000-0000-4000-8000-000000000009',`Get a cake only for my party on ${pastDate}. Do not arrange it after that date.`,'The party passed without a cake being arranged.',{outcome:'completed',verified:true});
const followupText='Help me find a hotel for my Ottawa trip on November 18.';
const followup={...source('00000000-0000-4000-8000-000000000010',followupText,'A budget is still needed before comparing hotels.',{outcome:'needs_user',verified:true}),sourceType:'proactive',userTurns:[{text:'Join a running club',at:steak.createdAt,authored:false},{text:followupText,at:steak.createdAt,authored:true}]};
sources.push(steak,cake,followup);
const updates=await extractOpportunities('synthetic-eval@example.invalid',sources,[],now,{model:openai('gpt-6-luna'),timeZone:'America/Toronto'});
console.log(JSON.stringify({proposed:updates.map(({basis,kind,status,title,supportingEvidence})=>({basis,kind,status,title,supportingEvidence}))},null,2));
const accepted=updates.flatMap(update=>{const item=groundedOpportunity(update,sources,[],now);return item?[item]:[];});
assert.ok(accepted.some(lead=>lead.sourceRunId===sources[0].id&&['open','waiting'].includes(lead.status)), 'Blocked purchase should remain a goal.');
assert.ok(accepted.some(lead=>lead.sourceRunId===sources[1].id&&lead.kind==='plan'), 'Booked future trip should remain a plan.');
assert.ok(!accepted.some(lead=>lead.sourceRunId===sources[2].id||lead.sourceRunId===sources[3].id), 'Tests and one-off puzzles must not become ongoing goals.');
assert.ok(!accepted.some(lead=>/running club|group run/i.test(lead.title+' '+lead.summary)), 'A treadmill request must not become a group-run preference.');
assert.ok(accepted.some(lead=>lead.basis==='repeated_purchase'&&lead.kind==='routine'), 'Repeated verified candy purchases should support a narrow recurring pattern without an explicit preference statement.');
assert.ok(accepted.some(lead=>lead.sourceRunId===steak.id&&['open','waiting'].includes(lead.status)&&lead.deadlineKind!=='hard_deadline'&&!lead.validUntil),'A blocked tonight attempt may retain the wish for a sensible recheck.');
assert.ok(!accepted.some(lead=>lead.sourceRunId===cake.id&&['open','waiting'].includes(lead.status)),'A genuinely final expired occasion must not be revived.');
assert.ok(accepted.some(lead=>lead.sourceRunId===followup.id&&['goal','plan'].includes(lead.kind)),'Genuine user intent inside a proactive chat must be remembered.');
console.log(JSON.stringify({accepted:accepted.map(({topicKey,status,kind,nextCheckAt,requiredChange})=>({topicKey,status,kind,nextCheckAt,requiredChange})),passed:true},null,2));

const renewalIdea:MorningIdea={topicKey:'steak-check',title:'Steak options',body:'Want me to check again for dinner?',category:'food',personalReason:'The original request remains unmet.',personalRefs:['opportunity:steak-check'],sourceUrls:[],whyNow:'It is a later service window after yesterday’s venues were closed.',expiresAt:new Date(now.getTime()+86400000).toISOString(),primary:{label:'Check options',intent:'Check current options without ordering.',actionType:'research'},alternative:{label:'Not now',intent:'Leave it for now.',actionType:'no_action'}};
const lead={ref:'opportunity:steak-check',topicKey:'steak-check',kind:'goal',status:'open',due:true,summary:'The user’s steak request was not fulfilled.',requiredChange:'A later sensible service window may remove the temporary closure blocker.',lastOffer:{topicKey:'steak-check',title:'Steak options',body:'Want me to check again for dinner?',whyNow:'Venues were closed last night.',intent:'Check suitable options.',decisionId:'old'}};
const review=await generateText({model:openai('gpt-6-luna'),providerOptions:{openai:{reasoningEffort:'medium',serviceTier:'default',store:false}},system:morningReviewGuidance,prompt:JSON.stringify({context:{opportunities:[lead]},previousSuggestions:[{ref:'last-offer:steak-check',topicKey:'steak-check',body:lead.lastOffer.body,status:'previously_suggested'}],candidates:[renewalIdea],research:'The candidate offers to verify current options, not claim availability or place an order. The earlier attempt ended because suitable venues were closed; the user did not reject the underlying wish.'}),output:Output.object({schema:morningReviewSchema}),maxOutputTokens:1500,maxRetries:0});
assert.ok(review.output);
assert.equal(keepNovelMorningReviews([renewalIdea],review.output.reviews,{opportunities:[lead],existing:[]} as unknown as MorningContext).kept.length,1,'Overlap must not veto a justified due-goal recheck.');
console.log(JSON.stringify({renewalReview:review.output.reviews,passed:true},null,2));
