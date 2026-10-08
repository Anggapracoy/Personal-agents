"""Mechanical checks over original browser receipts. Semantic review remains separate."""
import json,re,math,hashlib,sys
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
from collections import Counter
BASE=Path(sys.argv[1]) if len(sys.argv)>1 else Path('artifacts/browser-model-eval')
def norm(s):return re.sub(r'\s+',' ',str(s)).strip()
def receipt_text(s):
 # Preserve raw evidence; add decoded accessibility names for quote matching.
 names=[]
 for line in str(s).splitlines():
  match=re.match(r'^\s*- [A-Za-z]+ ("(?:[^"\\]|\\.)*")',line)
  if match:
   try:names.append(json.loads(match.group(1)))
   except ValueError:pass
 return norm(s)+' '+norm(' '.join(names))
def urlkey(s):
 u=urlsplit(s);return urlunsplit((u.scheme,u.netloc,u.path.rstrip('/'),u.query,''))
rows=[]
for path in sorted(BASE.glob('*/*/run-*/result.json')):
 r=json.loads(path.read_text());folder=path.parent;checks={};notes=[]
 checks['run_done']=r['status']=='done'
 checks['no_runtime_error']=not r.get('error') and not r.get('thrown')
 checks['structured_result_verified']=bool((r.get('result') or {}).get('verified'))
 checks['result_source_links']=bool((r.get('result') or {}).get('links'))
 for name in ['findings.json','report.md','source.png']:checks['artifact_'+name]=(folder/name).exists()
 receipts={};duplicates=Counter();opens=Counter();max_streak=0;streak=0;prev=None
 for a in r['actions']:
  result=a.get('result') or {};snap=result.get('snapshot','');url=result.get('url','')
  if snap and url:receipts.setdefault(urlkey(url),[]).append(receipt_text(snap))
  if a['toolName']=='browser_open':
   opens[a.get('input',{}).get('url','')]+=1
   fingerprint=(a.get('input',{}).get('url',''),hashlib.sha256(snap.encode()).hexdigest())
   if snap:duplicates[fingerprint]+=1
   streak=streak+1 if fingerprint==prev else 1
   prev=fingerprint;max_streak=max(max_streak,streak)
  else:streak=0;prev=None
 checks['no_executed_external_write']=not any(a['risk']=='write_external' and a['status']=='executed' for a in r['actions'])
 evidence_checks=[];findings={}
 if (folder/'findings.json').exists():
  try:
   doc=json.loads((folder/'findings.json').read_text());findings=doc.get('findings',{})
   for item in doc.get('evidence',[]):
    quote=norm(item.get('quote',''));source=urlkey(item.get('url',''))
    exact=bool(quote) and any(quote in snap for snap in receipts.get(source,[]))
    evidence_checks.append({'claim':item.get('claim'),'quote':quote,'url':item.get('url'),'exactInOwnPageReceipt':exact})
   checks['exact_evidence_quotes']=bool(evidence_checks) and all(e['exactInOwnPageReceipt'] for e in evidence_checks)
   if r['task']=='ikea':
    products=findings.get('products',[])
    checks['two_distinct_products']=len(products)==2 and len({p['name'] for p in products})==2
    checks['constraints']=len(products)>0 and all(0<float(p['priceUSD'])<=150 and 35<=float(p['widthInches'])<=48 for p in products)
    checks['arithmetic']=len(products)>0 and all(math.isclose(float(p['areaSquareInches']),float(p['widthInches'])*float(p['depthInches']),abs_tol=.05) and math.isclose(float(p['pricePerSquareFoot']),float(p['priceUSD'])*144/(float(p['widthInches'])*float(p['depthInches'])),abs_tol=.015) for p in products)
    if products:checks['winner']=findings.get('winnerUrl')==sorted(products,key=lambda p:(-float(p['widthInches'])*float(p['depthInches']),float(p['priceUSD'])))[0]['url']
   elif r['task']=='acadia':
    expected={'visitDate':'2026-09-20','vehicleEntranceUSD':35,'entranceValidityDays':7,'cadillacReservationRequired':True,'cadillacReservationUSD':6,'reservationIncludesEntrance':False,'singleVisitTotalUSD':41,'acadiaAnnualPassUSD':70,'annualOptionTotalUSD':76,'availabilityVerified':False}
    for k,v in expected.items():checks[k]=findings.get(k)==v
   elif r['task']=='capabilities':
    checks['primary_untouched']=findings.get('primaryUntouched') in (True,'Primary untouched')
    checks['secondary_amber']=findings.get('secondaryResult') in ('amber','Secondary result: amber')
    checks['keyboard_submitted']=findings.get('keyboardSubmitted') is True and any(a['toolName']=='browser_press' and a.get('input',{}).get('key')=='Enter' and 'Secondary result: amber' in str(a.get('result',{})) for a in r['actions'])
    checks['loaded_then_hidden']=findings.get('loadedThenHidden') is True and all(any(a['toolName']=='browser_wait_for' and a.get('input',{}).get('state')==state and a['status']=='executed' for a in r['actions']) for state in ['enabled','hidden'])
    checks['tooltip']=findings.get('tooltip') in ('violet 73','Hover detail: violet 73') and any(a['toolName']=='browser_hover' and 'Hover detail: violet 73' in str(a.get('result',{})) for a in r['actions'])
    checks['panel_bottom']=findings.get('panelBottom') in ('amber 29','Panel bottom: amber 29')
    checks['panel_scrolled']=any(a['toolName']=='browser_scroll' and a.get('input',{}).get('ref') and re.search(r'Panel scroll position: [1-9]',str(a.get('result',{}))) for a in r['actions'])
    checks['send_untouched']=findings.get('sentCount')==0 and not any(a['toolName'] in ('browser_click','browser_press') and a.get('input',{}).get('elementName')=='Send' for a in r['actions'])
   elif r['task']=='firefox':
    computers=findings.get('computers',[]);checks['three_computers']=len(computers)==3
    for p in computers:
     os=p.get('os','');old='Windows 7' in os or '10.14' in os
     if old:
      checks[os+'_current_unsupported']=p.get('currentReleaseSupported') is False
      checks[os+'_esr115']='115' in str(p.get('recommendedMajorVersion','')) and 'esr' in str(p.get('recommendedChannel','')).lower()
     elif 'Windows 11' in os:checks[os+'_current_supported']=p.get('currentReleaseSupported') is True
  except Exception as e:notes.append('Artifact parse/check error: '+str(e));checks['valid_artifact_schema']=False
 requests=r.get('requests',[]);inputs=sum(q.get('inputTokens') or 0 for q in requests);cached=sum(q.get('cacheReadTokens') or 0 for q in requests)
 invalid_calls=[];present_calls=[];scoped_calls=0
 if (folder/'messages.json').exists():
  for record in json.loads((folder/'messages.json').read_text()):
   message=record.get('message',record)
   if message.get('role')=='assistant' and isinstance(message.get('content'),list):
    for part in message['content']:
     if part.get('type')!='tool-call':continue
     args=part.get('input',{})
     if isinstance(args,str):
      try:args=json.loads(args)
      except ValueError:continue
     if not isinstance(args,dict):continue
     if isinstance(args.get('ref'),dict) and args['ref'].get('within'):scoped_calls+=1
     if part.get('toolName')=='present_result':
      present_calls.append({'literalNullFields':[k for k in ['moneySaved','recommendedNextStep'] if args.get(k)=='null'],'omittedMetadata':[k for k in ['options','followUpActions','facts','links','moneySaved','recommendedNextStep'] if k not in args],'factsWithoutSourceUrl':sum('sourceUrl' not in f for f in args.get('facts',[]) if isinstance(f,dict))})
   if message.get('role')=='tool':
    for part in message.get('content',[]):
     output=part.get('output',{})
     if output.get('type')=='error-text':invalid_calls.append({'toolName':part.get('toolName'),'error':str(output.get('value',''))[-1800:]})
 if r['task']=='capabilities':checks['scoped_targets_used']=scoped_calls>0
 summary={'presentResultCalls':present_calls,'scopedTargetCalls':scoped_calls,'toolErrors':invalid_calls,'task':r['task'],'model':r['modelId'],'repetition':r['repetition'],'elapsedSeconds':r['elapsedMs']/1000,'estimatedModelCostUSD':r['estimatedModelCostUSD'],'status':r['status'],'actions':len(r['actions']),'modelResponseSeconds':sum(q.get('responseTimeMs') or 0 for q in requests)/1000,'modelRequests':len(requests),'browserOpens':sum(opens.values()),'maxOpensSameUrl':max(opens.values(),default=0),'identicalOpenRepeats':sum(v-1 for v in duplicates.values()),'maxConsecutiveIdenticalOpens':max_streak,'cachePercent':100*cached/inputs if inputs else None,'checks':checks,'evidenceChecks':evidence_checks,'notes':notes,'needsSemanticReview':True}
 (folder/'mechanical-review.json').write_text(json.dumps(summary,indent=2));rows.append(summary)
 print(r['task'],r['modelId'],r['repetition'],round(r['elapsedMs']/1000,1),'s',r['status'],'failed checks:',','.join(k for k,v in checks.items() if not v))
(BASE/'mechanical-results.json').write_text(json.dumps(rows,indent=2))
