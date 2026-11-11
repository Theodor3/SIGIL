"""Bounded parser for the audited official NS Item11 XLSX template; fails closed."""
import io,zipfile,posixpath,re,hashlib
import xml.etree.ElementTree as E
from datetime import date,datetime,timedelta
from decimal import Decimal
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
MAX_RAW=1000000

def parse_ns(raw):
 if len(raw)>MAX_RAW:raise ValueError('Workbook size limit')
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  infos=z.infolist()
  if len(infos)>300 or len({i.filename for i in infos})!=len(infos) or sum(i.file_size for i in infos)>12000000:raise ValueError('ZIP bounds/duplicates')
  def xml(name):
   b=z.read(name)
   if b'<!DOCTYPE' in b.upper() or b'<!ENTITY' in b.upper():raise ValueError('XML declaration rejected')
   return E.fromstring(b)
  wb=xml('xl/workbook.xml');pr=wb.find('s:workbookPr',N)
  if pr is not None and pr.get('date1904','0').lower() not in ('0','false'):raise ValueError('Unsupported date epoch')
  ss=[''.join(x.itertext()) for x in xml('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in z.namelist() else []
  rels={r.get('Id'):r for r in xml('xl/_rels/workbook.xml.rels')}
  sheets=[s for s in wb.findall('.//s:sheet',N) if s.get('name')=='Carloadings (Item 11)']
  if len(sheets)!=1:raise ValueError('Unknown or ambiguous template sheet')
  sheet=sheets[0];rel=rels[sheet.get(RID)]
  if rel.get('TargetMode')=='External':raise ValueError('External relationship')
  target=rel.get('Target');path=posixpath.normpath(posixpath.join('xl',target)) if not target.startswith('/') else target.lstrip('/')
  if not path.startswith('xl/worksheets/') or '..' in path.split('/'):raise ValueError('Unsafe sheet path')
  wanted={'A1','A3','B3','E3','E4','A6','A16','B16','C16','D8','D16'};cells={};formulas={}
  for c in xml(path).findall('.//s:c',N):
   ref=c.get('r')
   if ref not in wanted:continue
   if ref in cells:raise ValueError('Duplicate required cell')
   f=c.find('s:f',N)
   if f is not None:
    expected={'A3':"'Rail Service (Item Nos. 1-6)'!A3",'B3':"'Rail Service (Item Nos. 1-6)'!B3:B4"}
    if ref not in expected or f.text!=expected[ref]:raise ValueError('Unsupported formula in required cell')
    formulas[ref]=f.text
   v=c.find('s:v',N);value=v.text if v is not None else ''
   if c.get('t')=='s':value=ss[int(value)]
   elif c.get('t')=='inlineStr':value=''.join(c.find('s:is',N).itertext())
   cells[ref]=value.strip()
  if formulas:
   primary=[s for s in wb.findall('.//s:sheet',N) if s.get('name')=='Rail Service (Item Nos. 1-6)']
   if len(primary)!=1:raise ValueError('Missing identity source sheet')
   rr=rels[primary[0].get(RID)]
   if rr.get('TargetMode')=='External':raise ValueError('External identity source')
   tt=rr.get('Target');pp=posixpath.normpath(posixpath.join('xl',tt)) if not tt.startswith('/') else tt.lstrip('/')
   if not pp.startswith('xl/worksheets/'):raise ValueError('Identity sheet path')
   pc={c.get('r'):c for c in xml(pp).findall('.//s:c',N)}
   for ref in formulas:
    c=pc[ref]
    if c.find('s:f',N) is not None:raise ValueError('Chained identity formula')
    v=c.find('s:v',N);value=v.text if v is not None else ''
    if c.get('t')=='s':value=ss[int(value)]
    elif c.get('t')=='inlineStr':value=''.join(c.find('s:is',N).itertext())
    if value.strip()!=cells[ref]:raise ValueError('Identity cache disagrees with source cell')
  if not wanted<=cells.keys():raise ValueError('Missing required cell')
  if cells['A3']!='Railroad: NS' or cells['A16'] not in ('','NS') or cells['B16']!='Grain' or cells['C16']!='H' or cells['D8']!='Originated':raise ValueError('Carrier/commodity/column mismatch')
  if 'EP 724' not in cells['A1'] or 'Weekly Originated and Received Carloads' not in cells['A6']:raise ValueError('Unverified metric/units')
  def dt(s):
   if re.fullmatch(r'\d+',s):return date(1899,12,30)+timedelta(days=int(s))
   return datetime.strptime(s,'%m/%d/%Y').date()
  start,end=dt(cells['E3']),dt(cells['E4'])
  if start.weekday()!=6 or (end-start).days!=6 or cells['B3']!='Year: '+str(start.year):raise ValueError('Inconsistent native grain period')
  value=Decimal(cells['D16'])
  if not value.is_finite() or value<0 or value!=value.to_integral_value():raise ValueError('Invalid carload count')
  detail={'operator':'NS','commodity':'Grain','column':'Originated','units':'carloads','sheet':sheet.get('name'),'value_cell':'D16','period_cells':['E3','E4'],'period_start':str(start),'period_end':str(end),'source_cells':cells,'identity_formula_bindings':formulas,'source_sha256':hashlib.sha256(raw).hexdigest(),'parser_version':'ns-item11-v1','publication_at':None,'historical_vintage_verified':False}
  return {'week':str(start),'value':int(value),'detail':detail}
