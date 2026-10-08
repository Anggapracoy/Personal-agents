import { createTemporalContext } from '../temporal';
import { inngest } from '../harness/inngest-client';
import { engineOwners } from './engine/candidates';
import { isMorningAllowed } from './morning-access';
import { refreshOpportunities, claimOpportunityChecks } from './opportunities';
import { loadMorningContext, type MorningContext } from './morning-context';
import { generateMorningIdeas } from './morning-ideas';
import { previousMorningIdeas, publishOpportunityPass } from './morning-jobs';
import { deliverPendingPushNotifications } from '../push-notifications';

export const opportunitySweepWorker=inngest.createFunction({id:'dispatch-personal-opportunities',retries:2,concurrency:1,triggers:[{cron:'*/30 * * * *'}]},async({step})=>{
 const owners=await step.run('find-enabled-owners',async()=>{const accounts=await engineOwners();const now=new Date();return accounts.filter(account=>{const hour=Number(createTemporalContext(account.timeZone,now).currentLocalDateTime.slice(11,13));return hour>=8&&hour<22;});});
 if(owners.length)await step.sendEvent('check-enabled-owners',owners.map(({owner})=>({name:'decision-feed/opportunities.due',data:{owner}})));
 return {owners:owners.length};
});
export const opportunityCheckWorker=inngest.createFunction({id:'check-personal-opportunities',retries:2,concurrency:[{limit:1,key:'event.data.owner'}],triggers:[{event:'decision-feed/opportunities.due'}]},async({event,step})=>{
 const {owner}=event.data as {owner:string};
 if(!await step.run('verify-proactive-access',()=>isMorningAllowed(owner)))return {disabled:true};
 await step.run('remember-updated-goals',()=>refreshOpportunities(owner));
 const checked=await step.run('claim-due-personal-leads',()=>claimOpportunityChecks(owner));
 if(!checked.length)return {checked:0,published:0};
 const input=await step.run('load-relevant-context',async()=>{
  const [context,previous]=await Promise.all([loadMorningContext(owner,new Date(),checked),previousMorningIdeas(owner)]);
  const sources=new Set(checked.flatMap(lead=>lead.sourceRunIds.map(id=>`chat:${id}`)));
  return {context:{...context,discoveryMode:'opportunity-check',conversations:context.conversations.filter(chat=>sources.has(chat.ref)),facts:[],opportunities:context.opportunities?.filter(lead=>lead.due)} as MorningContext,previous};
 });
 const report=await step.run('verify-new-value',async()=>{if(!await isMorningAllowed(owner))throw new Error('Proactive access disabled.');return generateMorningIdeas(input.context,input.previous);});
 const published=await step.run('publish-with-revision-fence',()=>publishOpportunityPass(owner,report,checked));
 if(published.published)await step.run('deliver-qualified-notifications',()=>deliverPendingPushNotifications({ownerEmail:owner,includeRecent:true}));
 return {checked:checked.length,...published};
});
