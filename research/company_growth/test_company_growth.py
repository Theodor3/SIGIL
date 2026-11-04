import copy,hashlib,importlib.util,json,shutil,sqlite3
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
import pytest
spec=importlib.util.spec_from_file_location('panel_receipt_v2',Path(__file__).with_name('panel.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
ROOT=Path(__file__).parent
AT=datetime(2026,11,4,14,30,tzinfo=timezone.utc)

def synthetic_sources(root):
 """Invented source bytes for validation tests; not primary evidence."""
 (root/'sources').mkdir(parents=True,exist_ok=True)
 original_plan=json.loads((ROOT/'reviewed-curation-plan.json').read_text());plan=[]
 financial={'cik':'0000012927','name':'BOEING CO','tickers':['BA','BA-PA'],'fiscalYearEnd':'1231','test_only':True,'filings':{'recent':{
  'form':['10-Q','10-Q','10-Q','10-K'],
  'accessionNumber':['0001628280-26-067508','0001628280-26-050038','0001628280-26-026458','0001628280-26-004357'],
  'filingDate':['2026-10-27','2026-07-28','2026-04-22','2026-01-30'],
  'reportDate':['2026-09-30','2026-06-30','2026-03-31','2025-12-31'],
  'acceptanceDateTime':['2026-10-27T17:51:22Z','2026-07-28T17:16:22Z','2026-04-22T16:38:40Z','2026-01-30T19:24:40Z'],
  'primaryDocument':['synthetic-q3.htm','synthetic-q2.htm','synthetic-q1.htm','synthetic-annual.htm']}}}
 for item in original_plan:
  item=copy.deepcopy(item);name=item['name'];r=item['reviewed_receipt']
  body=json.dumps(financial).encode() if name=='inventory' else ('SYNTHETIC TEST ONLY '+name).encode()
  r['sha256']=p.digest(body);r['bytes']=len(body);r['test_only']=True
  raw={k:r[k] for k in ['url','received_at','sha256','bytes']};raw['test_only']=True
  (root/'sources'/(name+'.bin')).write_bytes(body)
  (root/'sources'/(name+'.receipt.json')).write_text(json.dumps(r))
  (root/'sources'/(name+'.capture.json')).write_text(json.dumps(raw))
  plan.append(item)
 return plan

@pytest.fixture
def work(tmp_path):
 shutil.copyfile(ROOT/'parent-membership.json',tmp_path/'parent-membership.json')
 synthetic_sources(tmp_path)
 with patch.object(p,'now',return_value=AT):m=p.freeze_membership(tmp_path)
 data=json.loads((ROOT/'boeing-input.template.json').read_text());data['input_inventory']['reviewed_at']=AT.isoformat()
 for row,revenue,op in zip(data['history'],[120,100,80],[12,20,16]):row.update(revenue=revenue,operating_income=op,table_reference='Synthetic quarterly fixture; not actual issuer data')
 return tmp_path,m,data

def issue(work,at=AT):
 root,m,data=work
 with patch.object(p,'now',return_value=at):return p.issue(root,data)

def mutate_inventory(work,change):
 root,m,data=work;path=root/data['sources']['inventory'];receipt=json.loads(path.read_text());body=root/receipt['body_file'];value=json.loads(body.read_text());change(value);raw=json.dumps(value).encode();body.write_bytes(raw);receipt['sha256']=p.digest(raw);path.write_text(json.dumps(receipt))

def mutate_receipt(work,key,field,value):
 root,m,data=work;path=root/data['sources'][key];r=json.loads(path.read_text());r[field]=value;path.write_text(json.dumps(r))

def test_same_membership_new_protocol_and_receipt_availability(work):
 root,m,data=work;old=json.loads((ROOT/'parent-membership.json').read_text())
 assert m['membership']==old['membership'] and m['frozen_at']==old['frozen_at']
 assert m['parent_membership_sha256']==p.digest((ROOT/'parent-membership.json').read_bytes())
 assert m['variant']=='membership-receipt-v2'
 result=issue(work)
 assert result['forecasts']['seasonal_no_growth']['revenue']=='80'
 assert result['forecasts']['growth_persistence']['revenue']=='96.0'
 rows=p.with_ledger(root,lambda l:l.records());forecast=next(r['protocol'] for r in rows if 'member' in r['protocol'])
 assert forecast['receipts']['inventory']['published_at'] is None
 assert forecast['receipts']['q1_filing']['published_at'] is None
 assert forecast['receipts']['q1_filing']['filing_accepted_at']=='2026-04-22T16:38:40.000Z'
 with pytest.raises(ValueError,match='Already issued'):issue(work)
 with patch.object(p,'now',return_value=AT):assert p.score(root,data['security_id'],None)['status']=='pending'
 p.render(root);text=(root/'index.html').read_text();assert '1 forecasts frozen' in text and '0.000 billion' in text
 assert 'Original version' not in text or 'unchanged' in text

@pytest.mark.parametrize('field,value',[
 ('received_at','2026-11-05T00:00:00Z'),('published_at','2026-10-27T17:51:22Z'),
 ('availability_basis','filing_acceptance'),('original_filer_cik','999'),('inventory_reviewed',False),
 ('url','https://example.com/submissions/CIK0000012927.json'),
])
def test_inventory_receipt_fail_closed(work,field,value):
 mutate_receipt(work,'inventory',field,value)
 with pytest.raises(ValueError):issue(work)
 assert len(p.with_ledger(work[0],lambda l:l.records()))==1

def test_stale_inventory_refused(work):
 work[2]['input_inventory']['reviewed_at']='2026-11-06T14:30:00Z'
 with pytest.raises(ValueError,match='Fresh inventory'):issue(work,datetime(2026,11,6,14,30,tzinfo=timezone.utc))

@pytest.mark.parametrize('change',[
 lambda v:v.update(cik='999'),lambda v:v.update(tickers=['BA-PA']),lambda v:v.update(fiscalYearEnd='0630'),
 lambda v:v['filings']['recent']['reportDate'].pop(),
 lambda v:v['filings']['recent']['acceptanceDateTime'].__setitem__(v['filings']['recent']['form'].index('10-Q'),'2027-01-01T00:00:00Z'),
 lambda v:v['filings']['recent']['reportDate'].__setitem__(v['filings']['recent']['form'].index('10-Q'),'2026-12-31'),
 lambda v:v['filings']['recent']['form'].__setitem__(v['filings']['recent']['form'].index('10-Q'),'10-Q/A'),
])
def test_inventory_identity_arrays_and_future_data(work,change):
 mutate_inventory(work,change)
 with pytest.raises(ValueError):issue(work)

@pytest.mark.parametrize('field,value',[
 ('latest_public_release_reviewed',False),('latest_release_source_id','inventory'),('release_completeness_note',''),
 ('latest_available_fiscal_quarter',4),('received_versions_reviewed',False),('reviewed_at','2026-11-03T14:30:00Z')
])
def test_manual_release_completeness_and_vintage_review(work,field,value):
 work[2]['input_inventory'][field]=value
 with pytest.raises(ValueError):issue(work)

@pytest.mark.parametrize('field,value',[
 ('filing_accepted_at','2026-04-23T16:38:40Z'),('filing_accession','0001628280-26-999999'),
 ('filing_report_date','2026-06-30'),('filing_identity_reviewed',False),('published_at','2026-04-22T16:38:40Z'),
])
def test_filing_acceptance_bound_separately_and_never_publication(work,field,value):
 mutate_receipt(work,'q1_filing',field,value)
 with pytest.raises(ValueError):issue(work)

def test_calendar_and_financial_source_binding(work):
 work[2]['history'][0]['start']='2026-07-02'
 with pytest.raises(ValueError,match='Calendar inference'):issue(work)
 work[2]['history'][0]['start']='2026-07-01';work[2]['history'][0]['source_id']='inventory'
 with pytest.raises(ValueError,match='Financial amounts'):issue(work)

def test_fully_future_original_target_required(work):
 work[2]['target']=dict(fiscal_year=2026,fiscal_quarter=4,start='2026-10-01',end='2026-12-31')
 with pytest.raises(ValueError,match='fully future'):issue(work)

def test_parent_or_source_changes_refused(work):
 root,m,data=work;(root/'sources/q1-release.bin').write_bytes(b'not the retained original bytes')
 with pytest.raises(ValueError,match='Source bytes'):issue(work)
 other=root/'other';other.mkdir();(other/'parent-membership.json').write_text('{}')
 with pytest.raises(ValueError,match='Pinned original'):p.freeze_membership(other)

def test_record_source_refuses_unsupported_curated_shapes(tmp_path):
 with pytest.raises(ValueError,match='curated-import'):p.record_source(tmp_path,'x',None,None,None,None,'issuer_filing_inventory')


def test_curated_import_preflights_before_writing(tmp_path):
 import prepare_boeing_receipts as importer
 fixture=tmp_path/'synthetic';plan=synthetic_sources(fixture)
 parent=tmp_path/'captures';(parent/'sources').mkdir(parents=True)
 for item in plan:
  old=item['parent_capture_name'];name=item['name']
  shutil.copyfile(fixture/'sources'/(name+'.bin'),parent/'sources'/(old+'.bin'))
  shutil.copyfile(fixture/'sources'/(name+'.capture.json'),parent/'sources'/(old+'.receipt.json'))
 dest=tmp_path/'dest'
 with pytest.raises(ValueError,match='curator'):importer.prepare(parent,dest,plan)
 assert not dest.exists()
 wrong=copy.deepcopy(plan);wrong[1]['reviewed_receipt']['sha256']='0'*64
 with pytest.raises(ValueError,match='does not match'):importer.prepare(parent,dest,wrong,True)
 assert not dest.exists()
 assert importer.prepare(parent,dest,plan,True)['sources_imported']==4
 before={f.name:f.read_bytes() for f in (dest/'sources').iterdir()}
 with pytest.raises(ValueError,match='preserves existing'):importer.prepare(parent,dest,plan,True)
 assert before=={f.name:f.read_bytes() for f in (dest/'sources').iterdir()}
