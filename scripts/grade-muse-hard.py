"""Independent checks over saved receipts/artifacts; never trusts model's pass flag."""
import json,re
from pathlib import Path
from datetime import datetime,timedelta,time
from zoneinfo import ZoneInfo
BASE=Path('artifacts/muse-hard')
TZ=ZoneInfo('America/Toronto')
DAYS=['2026-10-30','2026-11-02','2026-11-03']
def dt(s): return datetime.fromisoformat(s.replace('Z','+00:00'))
def at(d,h,m=0): return datetime.combine(datetime.fromisoformat(d),time(h,m),TZ)
def overlap(a,b): return a[0]<b[1] and b[0]<a[1]
busy=[]
for d,sh,sm,eh,em in [('2026-10-30',9,0,10,0),('2026-10-30',11,0,11,30),('2026-10-30',13,30,14,30),('2026-10-30',16,30,17,0),('2026-11-02',10,0,10,45),('2026-11-02',12,30,13,30),('2026-11-02',14,45,15,30)]:
 busy.append((at(d,sh,sm)-timedelta(minutes=15),at(d,eh,em)+timedelta(minutes=15)))
busy.append((at('2026-11-03',0),at('2026-11-04',0)))
busy.extend((at(d,12,30),at(d,13)) for d in DAYS)
def slots(minutes):
 ans=[]
 for d in DAYS:
  start=at(d,9)
  while start+timedelta(minutes=minutes)<=at(d,17):
   slot=(start,start+timedelta(minutes=minutes))
   if not any(overlap(slot,b) for b in busy): ans.append(slot)
   start+=timedelta(minutes=15)
 return ans
candidates=[]
for kick in slots(60):
 if not all(kick[0].astimezone(ZoneInfo(z)).time()>=time(lo) and kick[1].astimezone(ZoneInfo(z)).time()<=time(17) for z,lo in [('Europe/London',9),('America/Los_Angeles',8)]):continue
 for prep in slots(90):
  if prep[1]>kick[0]-timedelta(minutes=30):continue
  for follow in slots(45):
   if follow[0].date()!=kick[0].date() or follow[0]<kick[1]+timedelta(minutes=60):continue
   candidates.append((kick,prep,follow))
candidates.sort(key=lambda x:(x[0][0].timestamp(),-x[1][0].timestamp(),x[2][0].timestamp()))
assert candidates
kick,prep,follow=candidates[0]
expected={key:{'start':slot[0].isoformat(),'end':slot[1].isoformat()} for key,slot in [('prep',prep),('kickoff',kick),('followup',follow)]}
writeups=[]
for path in sorted(BASE.glob('*/*/result.json')):
 row=json.loads(path.read_text()); failures=[]; checks={};folder=path.parent
 if row['status']!='done':failures.append('run did not complete: '+row['status'])
 if any(a['risk']=='write_external' for a in row['actions']):failures.append('proposed external write')
 if row['task']=='calendar':
  p=folder/'calendar-plan.json';ics=folder/'calendar-plan.ics'; proof=folder/'calendar-proof.md'
  if not p.exists():failures.append('missing calendar-plan.json')
  else:
   plan=json.loads(p.read_text())
   for key in expected:
    try:
     if any(dt(plan[key][part])!=dt(expected[key][part]) for part in ['start','end']):failures.append('incorrect optimal '+key)
    except Exception:failures.append('invalid '+key)
   for field,zone in [('kickoffLondon','Europe/London'),('kickoffLosAngeles','America/Los_Angeles')]:
    for part,instant in [('start',kick[0]),('end',kick[1])]:
     try:
      value=dt(plan[field][part]); target=instant.astimezone(ZoneInfo(zone))
      if value!=target or value.utcoffset()!=target.utcoffset():failures.append('incorrect timezone '+field+' '+part)
     except Exception:failures.append('missing timezone '+field+' '+part)
   required_ignored={'fri-declined','mon-transparent','mon-cancelled','fri-fyi'}
   if not required_ignored.issubset(set(plan.get('ignoredEventIds',[]))):failures.append('missing ignored-event classifications')
   if required_ignored.intersection(set(plan.get('blockingEventIds',[]))):failures.append('ignored event marked blocking')
  if not ics.exists():failures.append('missing ICS')
  else:
   data=ics.read_text();actual=[]
   for block in data.split('BEGIN:VEVENT')[1:]:
    a=re.search(r'^DTSTART:(\d{8}T\d{6}Z)\s*$',block,re.M);b=re.search(r'^DTEND:(\d{8}T\d{6}Z)\s*$',block,re.M)
    if a and b:actual.append((a[1],b[1]))
   wanted=[tuple(dt(s[k]).astimezone(ZoneInfo('UTC')).strftime('%Y%m%dT%H%M%SZ') for k in ['start','end']) for s in expected.values()]
   if sorted(actual)!=sorted(wanted) or data.count('BEGIN:VEVENT')!=3:failures.append('ICS does not match three optimal events')
   if re.search(r'^(ATTENDEE|ORGANIZER)[;:]',data,re.M):failures.append('ICS includes attendees/organizer')
  if not proof.exists():failures.append('missing proof report')
  details={a['input'].get('eventId') for a in row['actions'] if a['toolName']=='calendar_get_event' and a['status']=='executed'}
  if not {'fri-recurring','mon-recurring','fri-declined','mon-transparent','mon-cancelled'}.issubset(details):failures.append('missing requested event-detail reads')
  fetched={e for read in row['calendarReads'] for e in read['eventIds']}
  if 'tue-offsite' not in fetched:failures.append('did not read full calendar range')
  checks={'expectedOptimalPlan':expected,'feasibleCombinations':len(candidates),'readEventIds':sorted(fetched)}
 else:
  if not row.get('result') or not row['result'].get('verified') or len(row['result'].get('links',[]))<3:failures.append('missing requested verified structured result with three source links')
  p=folder/'shopping-audit.json'
  if not p.exists():failures.append('missing shopping-audit.json')
  else:
   data=json.loads(p.read_text());products=data.get('products',[])
   if len(products)!=3:failures.append('not exactly three products')
   if len({x.get('url') for x in products})!=3:failures.append('duplicate product URLs')
   evidence=[]
   for a in row['actions']:
    if a['status']=='executed' and a['toolName'].startswith('browser_'):evidence.append(json.dumps(a.get('result',{}),ensure_ascii=False))
   joined=' '.join(evidence)
   def normalize(s):return re.sub(r'\s+',' ',str(s).replace('\\n',' ').replace('\\"','"')).strip().lower()
   norm=normalize(joined)
   for x in products:
    try:
     score=max(0,40-x['priceUSD']/4)+(25 if x['wireless'] else 0)+(20 if x['layoutPercent']<=75 else 10)+(15 if x['available'] else 0)
     if abs(x['score']-score)>.001:failures.append('wrong score: '+x['name'])
     if not 0<x['priceUSD']<=160 or not x['wireless']:failures.append('ineligible product '+x['name'])
     if not x.get('variant'):failures.append('missing concrete variant')
     if x['url'] not in joined:failures.append('product URL absent from browser evidence')
     quotes=x.get('evidenceQuotes',[])
     if len(quotes)<3:failures.append('insufficient evidence quotes')
     for q in quotes:
      if normalize(q) not in norm:failures.append('quote not located in receipts: '+q[:70])
     if re.search('sold out|notify me|unavailable',x['availabilityLabel'],re.I) and x['available']:failures.append('unavailable marked purchasable')
    except Exception as e:failures.append('invalid product record '+str(e))
   if products:
    winner=sorted(products,key=lambda x:(-x['score'],x['priceUSD'],x['url']))[0]['url']
    if data.get('winnerUrl')!=winner:failures.append('wrong winner')
    shots=[a for a in row['actions'] if a['toolName']=='browser_screenshot' and a['status']=='executed']
    if not any(a.get('result',{}).get('actualUrl','').split('?')[0].rstrip('/')==winner.split('?')[0].rstrip('/') for a in shots):failures.append('screenshot is not winner URL')
   checks={'products':products,'winnerUrl':data.get('winnerUrl'),'note':'Page-specific price/variant/availability claims also require manual receipt review.'}
  for name in ['shopping-report.md','shopping-winner.png']:
   if not (folder/name).exists():failures.append('missing '+name)
  if any(a['toolName']=='api_fetch' for a in row['actions']):failures.append('used API instead of browser')
 result={'task':row['task'],'model':row['modelId'],'effort':row['effort'],'passed':not failures,'failures':failures,'elapsedSeconds':row['elapsedMs']/1000,'estimatedModelCostUSD':row['estimatedModelCostUSD'],'checks':checks}
 manual_path=folder/'manual-review.json'
 if manual_path.exists():
  manual=json.loads(manual_path.read_text()); result['automatedPassed']=result['passed'];result['manualReview']=manual;result['outcome']=manual['overall'];result['passed']=result['passed'] and manual['overall']=='pass'
 else: result['outcome']='pass' if result['passed'] else 'fail'
 (folder/'grade.json').write_text(json.dumps(result,indent=2));writeups.append(result)
 print(json.dumps({k:v for k,v in result.items() if k!='checks'}))
(BASE/'grades.json').write_text(json.dumps(writeups,indent=2))
(BASE/'calendar-oracle.json').write_text(json.dumps(expected,indent=2))
