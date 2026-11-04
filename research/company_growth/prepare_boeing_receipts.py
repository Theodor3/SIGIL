"""Reviewed offline import of specific retained Boeing captures; no network or issuance."""
import argparse,hashlib,json,re
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlparse

def prepare(parent,destination,plan,reviewed=False):
 if not reviewed:raise ValueError('Explicit curator review declaration required; this does not authenticate sources')
 pending=[]
 if not isinstance(plan,list) or len(plan)!=4:raise ValueError('Four reviewed evidence sources required')
 for item in plan:
  name=item['name'];old=item['parent_capture_name'];receipt=item['reviewed_receipt']
  if not re.fullmatch(r'[a-z0-9_-]{1,60}',name) or not re.fullmatch(r'[a-z0-9_-]{1,60}',old):raise ValueError('Bounded source identities required')
  body_path=parent/'sources'/(old+'.bin')
  if body_path.stat().st_size>5000000:raise ValueError('Source exceeds fixed bound')
  body=body_path.read_bytes();raw=json.loads((parent/'sources'/(old+'.receipt.json')).read_text())
  sha=hashlib.sha256(body).hexdigest()
  if len(body)>5000000 or sha!=receipt['sha256'] or sha!=raw['sha256'] or receipt['received_at']!=raw['received_at'] or receipt['url']!=raw['url']:raise ValueError('Reviewed evidence does not match original capture')
  parsed=urlparse(raw['url'])
  if parsed.scheme!='https' or parsed.username or parsed.password:raise ValueError('Public source URL required')
  if receipt['body_file']!='sources/'+name+'.bin':raise ValueError('Local receipt body path mismatch')
  at=datetime.fromisoformat(raw['received_at'].replace('Z','+00:00'))
  if at.tzinfo is None or at>datetime.now(timezone.utc):raise ValueError('Actual nonfuture capture time required')
  for filename,data in [(name+'.bin',body),(name+'.receipt.json',(json.dumps(receipt,indent=2)+'\n').encode()),(name+'.capture.json',(json.dumps(raw,indent=2)+'\n').encode())]:
   path=destination/'sources'/filename
   if path.exists():raise ValueError('Import preserves existing evidence; destination must be empty')
   pending.append((path,data))
 if len({str(path) for path,data in pending})!=len(pending):raise ValueError('Duplicate destination identities refused')
 for path,data in pending:
  path.parent.mkdir(parents=True,exist_ok=True)
  with path.open('xb') as f:f.write(data)
 return {'sources_imported':len(plan),'network_calls':0,'forecasts_issued':0,'review_declarations_are_not_authentication':True}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--reviewed',action='store_true');parser.add_argument('--destination',required=True);args=parser.parse_args();root=Path(__file__).parent
 print(json.dumps(prepare(root.parent,Path(args.destination),json.loads((root/'reviewed-curation-plan.json').read_text()),args.reviewed),indent=2))
