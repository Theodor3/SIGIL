import base64,json,hashlib,io,zipfile
from pathlib import Path
import xml.etree.ElementTree as E
import pytest
from stb_parser import parse_ns,N
from capture_once import allowed,capture_once
F=json.loads(Path('fixtures.json').read_text()) if Path('fixtures.json').exists() else []
def raw(label):
 if F:return base64.b64decode(next(x['base64'] for x in F if x['label']==label))
 # Original government workbooks remain local. Deterministic synthetic template for portable CI.
 cells={'A1':'EP 724 reporting','A3':'Railroad: NS','B3':'Year: 2025','E3':'45830','E4':'45836','A6':'11. Weekly Originated and Received Carloads by 22 Commodity Categories','A16':'NS','B16':'Grain','C16':'H','D8':'Originated','D16':'2499'}
 root=E.Element('{'+N['s']+'}worksheet');sd=E.SubElement(root,'{'+N['s']+'}sheetData')
 for ref,value in cells.items():
  c=E.SubElement(sd,'{'+N['s']+'}c',{'r':ref})
  if ref=='D16':E.SubElement(c,'{'+N['s']+'}v').text=value
  else:
   c.set('t','inlineStr');el=E.SubElement(c,'{'+N['s']+'}is');E.SubElement(el,'{'+N['s']+'}t').text=value
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('xl/workbook.xml','<workbook xmlns="'+N['s']+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Carloadings (Item 11)" sheetId="1" r:id="r1"/></sheets></workbook>')
  z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
  z.writestr('xl/worksheets/sheet1.xml',E.tostring(root))
 return out.getvalue()
@pytest.mark.parametrize('item',F,ids=[x['label'] for x in F])
def test_original_files(item):
 b=base64.b64decode(item['base64']);assert hashlib.sha256(b).hexdigest()==item['sha256'];assert len(b)==item['bytes']
 if item['label'].startswith('CSXT'):
  with pytest.raises(ValueError):parse_ns(b)
 else:
  r=parse_ns(b);assert r['value']==item['value'];assert r['week']==item['week'];assert r['detail']['publication_at'] is None

def change(cell,text):
 b=raw('NS-2025-06-27');out=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(b)) as z,zipfile.ZipFile(out,'w') as w:
  for name in z.namelist():
   data=z.read(name)
   if name=='xl/worksheets/sheet11.xml':pass
   # Locate actual grain XML by the required unique original value/labels, avoiding sheet order assumptions.
   if name.startswith('xl/worksheets/') and name.endswith('.xml'):
    root=E.fromstring(data);cells={c.get('r'):c for c in root.findall('.//s:c',N)}
    if 'D16' in cells and 'E3' in cells and cells['D16'].find('s:v',N) is not None and cells['D16'].find('s:v',N).text=='2499':
     c=cells[cell];c.set('t','inlineStr')
     for child in list(c):c.remove(child)
     el=E.SubElement(c,'{'+N['s']+'}is');E.SubElement(el,'{'+N['s']+'}t').text=text
     data=E.tostring(root)
   w.writestr(name,data)
 return out.getvalue()
@pytest.mark.parametrize('cell,text',[('D8','Received'),('A16','CSXT'),('E4','45837'),('D16','-1'),('D16','NaN'),('D16','2.5'),('A6','Unknown units')])
def test_mutated_source_rejected(cell,text):
 with pytest.raises(ValueError):parse_ns(change(cell,text))
def test_zip_bound():
 with pytest.raises(ValueError,match='size'):parse_ns(b'a'*1000001)
@pytest.mark.parametrize('url',['http://www.stb.gov/wp-content/uploads/files/rsir/NS/a.xlsx','https://evil.test/a.xlsx','https://www.stb.gov.evil.test/a.xlsx','https://www.stb.gov/wp-content/uploads/files/rsir/NS/a.xlsx?token=secret'])
def test_url_boundary(url):
 with pytest.raises(ValueError):allowed(url)

def test_capture_actual_clock_and_bytes(tmp_path,monkeypatch):
 b=raw('NS-2025-06-27')
 class Response:
  status=200;headers={'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Last-Modified':'Thu, 03 Jul 2025 12:55:52 GMT'}
  def __enter__(self):return self
  def __exit__(self,*a):pass
  def read(self,n):return b
 class Opener:
  def open(self,*a,**kw):return Response()
 monkeypatch.setattr('urllib.request.build_opener',lambda *a:Opener())
 r=capture_once(tmp_path/'sample');assert r['status']=='captured_and_parsed';assert r['parsed']['week']=='2025-06-22';assert r['parsed']['value']==2499
 assert r['publication_at'] is None and not r['forecast_issued'];assert r['request_started_at']<=r['retrieval_completed_at'];assert (tmp_path/'sample'/(r['sha256']+'.xlsx')).read_bytes()==b
 import sqlite3
 db=sqlite3.connect(tmp_path/'sample'/'capture.sqlite3');assert db.execute('SELECT COUNT(*) FROM forecasts').fetchone()[0]==0
 with pytest.raises(FileExistsError):capture_once(tmp_path/'sample')

def test_failed_download_recorded(tmp_path,monkeypatch):
 class Opener:
  def open(self,*a,**kw):raise TimeoutError('synthetic timeout')
 monkeypatch.setattr('urllib.request.build_opener',lambda *a:Opener())
 r=capture_once(tmp_path/'failed');assert r['status']=='failed';assert (tmp_path/'failed'/'receipt.json').exists()


def test_redirect_rejected():
 from capture_once import NoRedirect
 with pytest.raises(ValueError,match='Redirect'):NoRedirect().redirect_request(None,None,None,None,None,None)

def test_mutated_formula_not_evaluated():
 b=raw('NS-2025-06-27');out=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(b)) as z,zipfile.ZipFile(out,'w') as w:
  for name in z.namelist():
   data=z.read(name)
   if name.startswith('xl/worksheets/') and name.endswith('.xml'):
    root=E.fromstring(data);cells={c.get('r'):c for c in root.findall('.//s:c',N)}
    if 'D16' in cells and cells['D16'].find('s:v',N) is not None and cells['D16'].find('s:v',N).text=='2499':
     E.SubElement(cells['D16'],'{'+N['s']+'}f').text='1+1';data=E.tostring(root)
   w.writestr(name,data)
 with pytest.raises(ValueError,match='formula'):parse_ns(out.getvalue())

@pytest.mark.parametrize('url',['https://www.stb.gov/wp-content/uploads/files/rsir/NS/%2e%2e%2fother.xlsx','https://www.stb.gov/wp-content/uploads/files/rsir/NS/abc%252fother.xlsx','https://www.stb.gov/wp-content/uploads/files/rsir/NS/a%5cb.xlsx'])
def test_encoded_path_boundary(url):
 with pytest.raises(ValueError):allowed(url)
