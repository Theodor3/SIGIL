"""Local-only prospective ledger kernel. No network, scheduler, broker or host paths."""
import hashlib,json,sqlite3,math,uuid,functools
from datetime import datetime,date,timedelta,timezone
from zoneinfo import ZoneInfo
UTC=timezone.utc
NY=ZoneInfo('America/New_York')
def stamp(s):
 d=datetime.fromisoformat(s.replace('Z','+00:00')) if isinstance(s,str) else s
 if d.tzinfo is None:raise ValueError('Timezone required')
 return d.astimezone(UTC)
def iso(t):return stamp(t).isoformat(timespec="microseconds")
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(b):return hashlib.sha256(b).hexdigest()
def closure(start):
 d=date.fromisoformat(start)
 if d.weekday()!=6:raise ValueError('Expected native Sunday')
 return datetime.combine(d+timedelta(days=7),datetime.min.time(),NY).astimezone(UTC)
def target(f):
 f=stamp(f);d=f.astimezone(NY).date();d+=timedelta(days=(6-d.weekday())%7)
 s=datetime.combine(d,datetime.min.time(),NY)
 if s.astimezone(UTC)<=f:s+=timedelta(days=7)
 e=datetime.combine(s.date()+timedelta(days=7),datetime.min.time(),NY)
 return iso(s),iso(e)
def atomic_snapshot(method):
 @functools.wraps(method)
 def wrapped(self,*args,**kwargs):
  with self.db:
   self.db.execute('BEGIN IMMEDIATE')
   return method(self,*args,**kwargs)
 return wrapped

def atomic_issue(method):
 @functools.wraps(method)
 def wrapped(self,protocol,slot,f):
  try:
   with self.db:
    self.db.execute('BEGIN IMMEDIATE')
    result=method(self,protocol,slot,f)
    self.db.execute('INSERT INTO attempts VALUES(?,?,?,?)',(uuid.uuid4().hex,protocol,'issued',canonical({'forecast':result[0],'recorded_at':iso(datetime.now(UTC))})))
   return result
  except Exception as exc:
   try:
    with self.db:self.db.execute('INSERT INTO attempts VALUES(?,?,?,?)',(uuid.uuid4().hex,protocol,'skipped',canonical({'slot':str(slot),'recorded_at':iso(datetime.now(UTC)),'reason':str(exc)})))
   except sqlite3.Error:
    exc.add_note('Skip audit could not be persisted; original failure preserved.')
   raise
 return wrapped
class Ledger:
 def __init__(self,path):
  self.db=sqlite3.connect(path);self.db.row_factory=sqlite3.Row;self.db.execute("PRAGMA foreign_keys=ON")
  self.db.executescript('''
 CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,protocol TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,url TEXT NOT NULL,sha TEXT NOT NULL,first_seen TEXT NOT NULL,raw BLOB NOT NULL,UNIQUE(url,sha));
 CREATE TABLE IF NOT EXISTS versions(receipt TEXT PRIMARY KEY REFERENCES receipts(id),week TEXT,value INTEGER,valid INTEGER NOT NULL,detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS forecasts(id TEXT PRIMARY KEY,protocol TEXT NOT NULL,slot TEXT NOT NULL,target TEXT NOT NULL,end TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(protocol,slot),UNIQUE(protocol,target,end));
 CREATE TABLE IF NOT EXISTS outcomes(forecast TEXT PRIMARY KEY REFERENCES forecasts(id),body TEXT NOT NULL);
 ''')
  for table in ('receipts','versions','forecasts','outcomes','attempts'):
   for op in ('UPDATE','DELETE'):
    self.db.execute(f'CREATE TRIGGER IF NOT EXISTS no_{op}_{table} BEFORE {op} ON {table} BEGIN SELECT RAISE(ABORT,"immutable"); END')
 def capture(self,url,raw,observed):
  """Caller supplies actual completed retrieval time. Identical bytes never renew first_seen."""
  t=iso(observed);sha=digest(raw);rid=digest((url+'\n'+sha).encode())
  with self.db:self.db.execute('INSERT OR IGNORE INTO receipts VALUES(?,?,?,?,?)',(rid,url,sha,t,raw))
  r=self.db.execute('SELECT * FROM receipts WHERE id=?',(rid,)).fetchone()
  if digest(r['raw'])!=sha:raise ValueError('Corrupt bytes')
  if stamp(t)<stamp(r['first_seen']):raise ValueError('Out-of-order receipt clock')
  return rid
 def register(self,rid,week,value,valid,detail):
  """Parsing is explicit; required NS/Grain/Originated/unit/sheet/cell evidence retained in detail."""
  if not self.db.execute('SELECT 1 FROM receipts WHERE id=?',(rid,)).fetchone():raise ValueError('Unknown receipt')
  if week is not None:closure(week)
  if valid:
   required={'operator':'NS','commodity':'Grain','column':'Originated','units':'carloads'}
   if week is None or type(value) is not int or value<0 or any(detail.get(k)!=v for k,v in required.items()) or not all(detail.get(k) for k in ('sheet','value_cell','period_cells')):raise ValueError('Invalid parsed observation')
  with self.db:self.db.execute('INSERT INTO versions VALUES(?,?,?,?,?)',(rid,week,value,int(valid),canonical(detail)))
 def rows(self,f):
  return [dict(r) for r in self.db.execute('SELECT r.*,v.week,v.value,v.valid,v.detail FROM receipts r LEFT JOIN versions v ON r.id=v.receipt WHERE r.first_seen<=? ORDER BY r.first_seen DESC,r.sha ASC,r.url ASC',(iso(f),))]
 @atomic_issue
 def issue(self,protocol,slot,f):
  f=stamp(f);slot=stamp(slot)
  if len(protocol)!=64 or any(c not in '0123456789abcdef' for c in protocol):raise ValueError('Protocol SHA required')
  if slot.weekday()!=3 or (slot.hour,slot.minute,slot.second,slot.microsecond)!=(18,30,0,0) or not slot<=f<slot+timedelta(minutes=15):raise ValueError('Missed or invalid weekly slot')
  rows=self.rows(f)
  if any(r['week'] is None for r in rows):raise ValueError('Unassigned potentially latest revision')
  selected={}
  for r in rows:
   if closure(r['week'])<=f:selected.setdefault(r['week'],r)
  if not selected:raise ValueError('No closed source weeks')
  latest=max(selected);weeks=[str(date.fromisoformat(latest)-timedelta(weeks=i)) for i in range(3,-1,-1)]
  if any(w not in selected or not selected[w]['valid'] for w in weeks):raise ValueError('Missing/invalid consecutive weeks')
  chosen=[selected[w] for w in weeks];last=chosen[-1]
  if not timedelta(0)<=f-stamp(last['first_seen'])<=timedelta(days=7) or not timedelta(0)<=f-closure(latest)<=timedelta(days=14):raise ValueError('Stale latest input')
  s,e=target(f);inputs=[{k:r[k] for k in ('id','url','sha','first_seen','week','value','detail')} for r in chosen]
  b={'schema_version':1,'protocol':protocol,'slot':iso(slot),'created_at':iso(f),'target_start':s,'target_end':e,'zone':'America/New_York','inputs':inputs,'P':sum(r['value'] for r in chosen)/4,'B':last['value']}
  body=canonical(b);fid=digest(body.encode())
  self.db.execute('INSERT INTO forecasts VALUES(?,?,?,?,?,?)',(fid,protocol,iso(slot),s,e,body))
  return fid,b
 @atomic_snapshot
 def finalize(self,fid,now):
  f=self.db.execute('SELECT body FROM forecasts WHERE id=?',(fid,)).fetchone()
  if f is None:raise ValueError('Unknown forecast')
  b=json.loads(f[0]);end=stamp(b['target_end']);deadline=end+timedelta(days=28);now=stamp(now)
  if now<deadline:raise ValueError('Wait for deterministic deadline')
  week=str(stamp(b['target_start']).astimezone(NY).date())
  known=self.rows(deadline)
  if any(r['week'] is None for r in known):raise ValueError('Unparsed receipt before outcome deadline')
  candidates=[r for r in known if r['week']==week and r['valid'] and end<stamp(r['first_seen'])<=deadline]
  candidates.sort(key=lambda r:(r['first_seen'],r['sha'],r['url']))
  r=candidates[0] if candidates else None
  out={'forecast':fid,'target_start':b['target_start'],'deadline':iso(deadline),'status':'scored' if r else 'missing','Y':r['value'] if r else None,'receipt':r['id'] if r else None,'source_sha':r['sha'] if r else None,'first_seen':r['first_seen'] if r else None}
  self.db.execute('INSERT INTO outcomes VALUES(?,?)',(fid,canonical(out)))
  return out
 def score(self,protocol):
  rows=self.db.execute('SELECT f.body AS f,o.body AS o FROM forecasts f LEFT JOIN outcomes o ON o.forecast=f.id WHERE f.protocol=? ORDER BY f.target',(protocol,))
  pairs=[];missing=0;pending=False;issued=0
  for r in rows:
   issued+=1
   if r['o'] is None:pending=True;continue
   if pending:raise ValueError('Earlier target unresolved')
   f,o=json.loads(r['f']),json.loads(r['o'])
   if o['status']=='missing':missing+=1;continue
   pairs.append((abs(f['P']-o['Y']),abs(f['B']-o['Y']),o['Y']))
  def partition(xs):
   return {'n':len(xs),'distinct':len({x[2] for x in xs}),'feasible':len(xs)==26 and len({x[2] for x in xs})>=5,'mae_P':sum(x[0] for x in xs)/len(xs) if xs else None,'mae_B':sum(x[1] for x in xs)/len(xs) if xs else None,'mae_difference_P_minus_B':sum(x[0]-x[1] for x in xs)/len(xs) if xs else None,'paired_errors':xs}
  attempts=[dict(r) for r in self.db.execute('SELECT status,COUNT(*) AS n FROM attempts WHERE protocol=? GROUP BY status',(protocol,))]
  return {'attempt_counts':attempts,'beyond_frozen_cohorts':max(0,len(pairs)-52),'issued':issued,'missing':missing,'pending':pending,'scored':len(pairs),'development':partition(pairs[:26]),'evaluation':partition(pairs[26:52])}
