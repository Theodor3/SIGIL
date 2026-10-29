"""One manual official-STB fetch, no schedules/forecasts. Actual clock boundaries only."""
import argparse,json,re,sqlite3,uuid,urllib.request,urllib.parse,hashlib
from datetime import datetime,timezone
from pathlib import Path
from ledger import Ledger,iso,canonical
from stb_parser import parse_ns,MAX_RAW
SAMPLE='https://www.stb.gov/wp-content/uploads/files/rsir/NS/NS%20Data%202025-07-02.xlsx'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Redirect rejected; verify official target explicitly')
def allowed(url):
 u=urllib.parse.urlsplit(url)
 if u.scheme!='https' or u.netloc!='www.stb.gov' or u.query or u.fragment or not re.fullmatch(r'/wp-content/uploads/files/rsir/NS/[A-Za-z0-9%_.-]+\.xlsx',u.path):raise ValueError('Not approved official NS XLSX URL')
 if re.search(r'%(?!20)',u.path,re.I):raise ValueError('Only encoded spaces permitted in filename')
 return url

def capture_once(root,url=SAMPLE):
 allowed(url);root=Path(root);root.mkdir(parents=True,exist_ok=False)
 ledger=Ledger(root/'capture.sqlite3')
 ledger.db.execute('CREATE TABLE capture_events(id TEXT PRIMARY KEY,body TEXT NOT NULL)')
 for op in ('UPDATE','DELETE'):ledger.db.execute(f'CREATE TRIGGER capture_{op} BEFORE {op} ON capture_events BEGIN SELECT RAISE(ABORT,"immutable"); END')
 (root/'INCOMPLETE').write_text('Do not ingest: capture has not completed.',encoding='utf-8')
 started=iso(datetime.now(timezone.utc));event={'url':url,'request_started_at':started,'publication_at':None,'mode':'manual_one_sample','forecast_issued':False,'receipt_scope':'this_manual_sample_store_only'}
 try:
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
  req=urllib.request.Request(url,headers={'User-Agent':'SIGIL Research/1.0 public STB sample'})
  with opener.open(req,timeout=30) as response:
   if response.status!=200:raise ValueError('Unexpected HTTP status')
   raw=response.read(MAX_RAW+1)
   if len(raw)>MAX_RAW:raise ValueError('Download exceeds limit')
   completed=iso(datetime.now(timezone.utc))
   event.update(http_status=response.status,retrieval_completed_at=completed,http_last_modified=response.headers.get('Last-Modified'),content_type=response.headers.get('Content-Type'))
  rid=ledger.capture(url,raw,completed);sha=hashlib.sha256(raw).hexdigest()
  (root/(sha+'.xlsx')).write_bytes(raw)
  event.update(receipt_id=rid,sha256=sha,bytes=len(raw))
  try:
   parsed=parse_ns(raw);ledger.register(rid,parsed['week'],parsed['value'],True,parsed['detail']);event.update(status='captured_and_parsed',parsed=parsed)
  except Exception as exc:
   ledger.register(rid,None,None,False,{'parser_error':type(exc).__name__+': '+str(exc),'parser_version':'ns-item11-v1'});event.update(status='captured_quarantined',error=type(exc).__name__+': '+str(exc))
 except Exception as exc:event.update(status='failed',error=type(exc).__name__+': '+str(exc),finished_at=iso(datetime.now(timezone.utc)))
 event['parser_code_sha256']=hashlib.sha256(Path(__file__).with_name('stb_parser.py').read_bytes()).hexdigest()
 with ledger.db:ledger.db.execute('INSERT INTO capture_events VALUES(?,?)',(uuid.uuid4().hex,canonical(event)))
 (root/'receipt.json').write_text(json.dumps(event,indent=2),encoding='utf-8');ledger.db.close()
 complete={'status':event['status'],'receipt_json_sha256':hashlib.sha256((root/'receipt.json').read_bytes()).hexdigest(),'note':'Only captured_and_parsed plus validated bytes may be imported; first_seen is store-local, reconcile earlier receipts before forecasting.'}
 (root/'COMPLETE.json').write_text(json.dumps(complete,indent=2),encoding='utf-8');return event
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--url',default=SAMPLE);a=p.parse_args();print(json.dumps(capture_once(a.output,a.url),indent=2))
