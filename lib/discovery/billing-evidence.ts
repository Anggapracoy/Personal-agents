import type {DecisionEmailInput} from '../agent';
import type {DiscoveryCandidate} from './types';

type Evidence = {candidate:DiscoveryCandidate; accounts:Set<string>; hosts:Set<string>; invoices:Set<string>; amounts:Set<string>; times:number[]};
const intersects=(a:Set<string>,b:Set<string>)=>[...a].some(v=>b.has(v));
const contradicts=(a:Set<string>,b:Set<string>)=>a.size>0&&b.size>0&&!intersects(a,b);

function evidence(candidate:DiscoveryCandidate,emails:Map<string,DecisionEmailInput>):Evidence|null {
 const sources=candidate.emailIds.map(id=>emails.get(id)).filter((e):e is DecisionEmailInput=>Boolean(e));
 const accounts=new Set<string>(),hosts=new Set<string>(),invoices=new Set<string>(),amounts=new Set<string>(),times:number[]=[];
 for(const e of sources){
  const text=`${e.subject} ${e.snippet} ${e.body}`;
  if(!/\b(?:payment|invoice|charge|billing)\b/i.test(text)||!/\b(?:failed|unsuccessful|unable|unpaid|overdue|declined|couldn[’']?t)\b/i.test(text))return null;
  for(const m of `${e.from} ${text} ${e.links.join(' ')}`.matchAll(/\bacct_[a-z0-9]{6,}\b/gi))accounts.add(m[0]);
  for(const m of text.matchAll(/\binvoice\s*(?:#|no\.?|number|id|:)\s*([a-z0-9][a-z0-9_-]{3,})\b/gi))invoices.add(m[1]!.toLowerCase());
  const amount=(e.subject.match(/(?:USD|CAD|EUR|GBP|\$|€|£)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i)??text.match(/(?:USD|CAD|EUR|GBP|\$|€|£)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i));
  if(amount)amounts.add(`${amount[0].replace(amount[1]!, '').trim().toUpperCase()}:${Number(amount[1]!.replaceAll(',','')).toFixed(2)}`);
  const time=Date.parse(e.date);if(Number.isFinite(time))times.push(time);
  for(const link of e.links)try{
   const url=new URL(link);if(url.protocol!=='https:')continue;
   if(/\/(?:billing|payments?|invoices?)(?:\/|$)/i.test(url.pathname))hosts.add(url.hostname.toLowerCase());
   for(const[key,value]of url.searchParams)if(/^invoice[_-]?id$/i.test(key)&&value)invoices.add(value.toLowerCase());
  }catch{/* Invalid source links cannot establish identity. */}
 }
 return accounts.size&&hosts.size?{candidate,accounts,hosts,invoices,amounts,times}:null;
}
function sameOccurrence(a:Evidence,b:Evidence){
 if(!intersects(a.accounts,b.accounts)||!intersects(a.hosts,b.hosts)||contradicts(a.invoices,b.invoices)||contradicts(a.amounts,b.amounts))return false;
 if(!a.invoices.size&&!b.invoices.size&&!a.amounts.size&&!b.amounts.size)return false;
 // This grouping is limited to notices sent at the exact same timestamp.
 // Later notices go through the existing update/relevance path.
 return a.times.length>0&&b.times.length>0&&new Set([...a.times,...b.times]).size===1;
}

/** Group processor/provider notices before research, without a provider list,
 * model call, title matching, or notification delivery gate. */
export function groupBillingEvidence(candidates:DiscoveryCandidate[],emails:DecisionEmailInput[]):DiscoveryCandidate[]{
 const byId=new Map(emails.map(e=>[e.id,e]));
 const items=candidates.map(candidate=>({candidate,evidence:evidence(candidate,byId)}));
 const groups:Array<{members:typeof items;candidate:DiscoveryCandidate}>=[];
 // Concrete invoices/amounts lead; an ambiguous notice matching multiple
 // separate obligations remains separate instead of bridging those groups.
 items.sort((a,b)=>((b.evidence?.invoices.size??0)*2+(b.evidence?.amounts.size??0))-((a.evidence?.invoices.size??0)*2+(a.evidence?.amounts.size??0)));
 for(const item of items){
  const matches=item.evidence?groups.filter(g=>g.members.every(m=>m.evidence&&sameOccurrence(item.evidence!,m.evidence))):[];
  if(matches.length!==1){groups.push({members:[item],candidate:item.candidate});continue;}
  const group=matches[0]!;group.members.push(item);
  group.candidate={...group.candidate,emailIds:[...new Set([...group.candidate.emailIds,...item.candidate.emailIds])],
   potentialValue:Math.max(group.candidate.potentialValue,item.candidate.potentialValue),
   triggerFacts:[...new Set([...group.candidate.triggerFacts,...item.candidate.triggerFacts])].slice(0,20),
   researchQuestions:[...new Set([...group.candidate.researchQuestions,...item.candidate.researchQuestions])].slice(0,20)};
 }
 return groups.map(g=>g.candidate);
}
