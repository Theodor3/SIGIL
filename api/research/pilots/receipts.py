"""Bounded public-source captures. Never infer old availability from current data."""
import json,hashlib,uuid,urllib.request
from pathlib import Path
from datetime import datetime,timezone

SOURCES={'fda':'https://api.fda.gov/drug/shortages.json?limit=5','procurement':'https://api.usaspending.gov/api/v2/search/spending_by_award/'}
PROCUREMENT_QUERY={'filters':{'keywords':['ICF'],'award_type_codes':['A','B','C','D'],'agencies':[{'type':'awarding','tier':'toptier','name':'Department of Health and Human Services'}]},'fields':['Award ID','Recipient Name','Award Amount','Awarding Agency','Start Date','End Date'],'page':1,'limit':5,'sort':'Award Amount','order':'desc'}
MAX_BYTES=1_000_000

def stamp(value):
    if not isinstance(value,str):raise ValueError('Timestamp missing')
    t=datetime.fromisoformat(value)
    if t.tzinfo is None or t.utcoffset() is None:raise ValueError('Aware time required')
    return t.astimezone(timezone.utc)

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(x):return hashlib.sha256(x).hexdigest()

def store(root,source,raw,*,requested_at,received_at,request_body=None,fixture=False):
    """Exact-repeat imports are idempotent; independent later fetches retain receipts."""
    if source not in SOURCES or type(raw) is not bytes or len(raw)>MAX_BYTES:raise ValueError('Unsupported source/size')
    if type(fixture) is not bool or stamp(received_at)<stamp(requested_at):raise ValueError('Invalid receipt times/type')
    json.loads(raw) # Parseable JSON, never execute supplied content.
    if request_body != (PROCUREMENT_QUERY if source=='procurement' else None):raise ValueError('Unexpected query')
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    meta=dict(schema_version=1,source=source,url=SOURCES[source],method='POST' if request_body else 'GET',request_body=request_body,requested_at=requested_at,received_at=received_at,available_at=received_at,source_publication_at=None,payload_sha256=digest(raw),bytes=len(raw),http_status=200,evidence_kind='synthetic_fixture' if fixture else 'current_capture_not_historical',parser_version='pilot-1')
    identity=digest(canonical(meta));payload=root/(identity+'.bin');receipt=root/(identity+'.json')
    meta['receipt_sha256']=identity
    if receipt.exists():
        existing,body=load(root,identity)
        if existing!=meta or body!=raw:raise ValueError('Conflicting immutable receipt')
        return identity
    if payload.exists():
        if payload.read_bytes()!=raw:raise ValueError('Conflicting orphan payload')
    else:
        with payload.open('xb') as f:f.write(raw)
    with receipt.open('xb') as f:f.write(canonical(meta))
    return identity

def load(root,identity):
    import re
    if not isinstance(identity,str) or not re.fullmatch(r'[a-f0-9]{64}',identity):raise ValueError('Invalid receipt identity')
    root=Path(root);m=json.loads((root/(identity+'.json')).read_bytes());raw=(root/(identity+'.bin')).read_bytes()
    unsigned={k:v for k,v in m.items() if k!='receipt_sha256'}
    if m.get('receipt_sha256')!=identity or digest(canonical(unsigned))!=identity or digest(raw)!=m.get('payload_sha256') or len(raw)!=m.get('bytes'):raise ValueError('Receipt integrity failure')
    return m,raw

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k):raise ValueError('Redirect not authorized for bounded pilot')

def capture(root,source):
    if source not in SOURCES:raise ValueError('Unsupported source')
    body=PROCUREMENT_QUERY if source=='procurement' else None
    rawbody=canonical(body) if body else None
    before=datetime.now(timezone.utc).isoformat()
    req=urllib.request.Request(SOURCES[source],data=rawbody,headers={'User-Agent':'SigilResearch/0.1 public-data feasibility','Content-Type':'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=30) as response:
        if response.status!=200:raise ValueError('Non-success source response')
        raw=response.read(MAX_BYTES+1)
    return store(root,source,raw,requested_at=before,received_at=datetime.now(timezone.utc).isoformat(),request_body=body)
