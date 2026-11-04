"""Local manual prospective panel. No HTTP, models, broker, or scheduler imports."""
import argparse,hashlib,html,json,re,zipfile
import xml.etree.ElementTree as ET
from datetime import datetime,date,timezone,timedelta
from decimal import Decimal,InvalidOperation,localcontext
from pathlib import Path
from urllib.parse import urlparse
from vendor_trial_ledger import TrialLedger,canonical

STUDY='company-growth-prospective-20-receipt-v2'
EXCLUDED={'AXP','GS','JPM','TRV','V','UNH'}
SCOPE='Current DIA equity holdings, excluding fixed banking/insurance/payment-services names AXP, GS, JPM, TRV, V and UNH. This is a narrow scoped panel, not a historical or representative market universe.'
ROOT=Path(__file__).parent

def now():return datetime.now(timezone.utc)
def digest(body):return hashlib.sha256(body).hexdigest()
def display_money(value):return '$'+format(Decimal(value)/Decimal('1e9'),'.3f')+' billion'
def timestamp(value):
    try:t=datetime.fromisoformat(value.replace('Z','+00:00'))
    except (ValueError,AttributeError):raise ValueError('Explicit aware timestamp required') from None
    if t.tzinfo is None or t.utcoffset() is None:raise ValueError('Explicit aware timestamp required')
    return t.astimezone(timezone.utc)
def atomic(path,body):
    path.parent.mkdir(parents=True,exist_ok=True)
    try:
        with path.open('xb') as f:f.write(body)
    except FileExistsError:
        if path.read_bytes()!=body:raise ValueError('Immutable artifact conflict') from None
def safe_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',value):raise ValueError('Invalid identity')
    return value
def code_hash():return digest(b'\0'.join((ROOT/name).read_bytes() for name in ('panel.py','vendor_trial_ledger.py','PROTOCOL.md','prepare_boeing_receipts.py','reviewed-curation-plan.json')))
def num(value):
    if isinstance(value,bool) or not isinstance(value,(str,int,float)):raise ValueError('Finite amount required')
    if len(str(value))>80:raise ValueError('Bounded numeric representation required')
    try:v=Decimal(str(value))
    except InvalidOperation:raise ValueError('Finite amount required') from None
    if not v.is_finite() or v.copy_abs()>Decimal('1e18') or (v!=0 and v.adjusted() < -12) or len(v.as_tuple().digits)>40:raise ValueError('Finite bounded amount required')
    return v
def period(row):
    start,end=(date.fromisoformat(row[k]) for k in ('start','end'))
    if not 75<=(end-start).days+1<=105:raise ValueError('Three-month quarter required; YTD refused')
    if type(row.get('fiscal_year')) is not int or not 1900<=row['fiscal_year']<=2100 or type(row.get('fiscal_quarter')) is not int or row['fiscal_quarter'] not in (1,2,3,4):raise ValueError('Explicit fiscal identity required')
    return start,end
def ordinal(row):return row['fiscal_year']*4+row['fiscal_quarter']
def record_source(root,identifier,file,url,published_at,cik,role,reviewed=False,first_original=False):
    """Local import only. Curator declarations are recorded, not authenticated."""
    if role not in ('issuer_quarter_data','issuer_quarter_result'):raise ValueError('V2 inventory/filing receipts require the reviewed curated-import path, not record-source')
    safe_id(identifier);at=now();parsed=urlparse(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:raise ValueError('Public HTTPS source required')
    if not isinstance(cik,str) or not cik.isdigit() or not 1<=len(cik)<=10 or int(cik)==0:raise ValueError('Original filer CIK required')
    if timestamp(published_at)>at:raise ValueError('Future publication refused')
    if role not in ('issuer_quarter_data','issuer_filing_inventory','fiscal_calendar','issuer_quarter_result'):raise ValueError('Explicit source role required')
    path=Path(file)
    if path.stat().st_size>5_000_000:raise ValueError('Source exceeds size bound')
    destination=root/'sources'/(identifier+'.bin');receipt_path=root/'sources'/(identifier+'.receipt.json')
    if destination.exists() or receipt_path.exists():raise ValueError('Source identity already captured; use a new revision identity')
    body=path.read_bytes()
    receipt=dict(url=url,body_file='sources/'+identifier+'.bin',sha256=digest(body),published_at=published_at,received_at=at.isoformat(),original_filer_cik=cik,
        publication_time_reviewed=reviewed,evidence_role=role,first_original_publication_reviewed=reviewed and first_original,
        source_version_kind='first_public_original' if reviewed and first_original else 'unverified_or_input_vintage',
        review_limit='Manual issuer/publication/original-version declarations; source hash authenticates neither publication nor accounting interpretation.')
    atomic(destination,body);atomic(receipt_path,canonical(receipt).encode())
    return dict(status='captured_locally',receipt='sources/'+identifier+'.receipt.json',reviewed=reviewed)

def source(root,reference,at):
    relative=Path(reference)
    base=(root/'sources').resolve();receipt_path=(root/relative).resolve()
    if relative.is_absolute() or not receipt_path.is_relative_to(base):raise ValueError('Source receipt must remain under sources')
    receipt=json.loads(receipt_path.read_text())
    body_path=(root/receipt['body_file']).resolve()
    if not body_path.is_relative_to(base):raise ValueError('Source body must remain under sources')
    if body_path.stat().st_size>5_000_000:raise ValueError('Source exceeds size bound')
    body=body_path.read_bytes()
    if digest(body)!=receipt['sha256']:raise ValueError('Source bytes changed')
    parsed=urlparse(receipt['url'])
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:raise ValueError('Public HTTPS source required')
    received=timestamp(receipt['received_at'])
    if received>at:raise ValueError('Future source receipt')
    return receipt,body

def holdings_rows(body):
    # Parse only a bounded standard XLSX; never execute macros or formulas.
    n={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(__import__('io').BytesIO(body)) as z:
        if sum(i.file_size for i in z.infolist())>5_000_000:raise ValueError('Workbook expansion bound exceeded')
        strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',n)]
        rows=[]
        for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row',n):
            cells={}
            for c in row:
                v=c.find('m:v',n)
                if v is not None:cells[re.sub('[0-9]','',c.attrib['r'])]=strings[int(v.text)] if c.get('t')=='s' else v.text
            rows.append(cells)
    label=next(r['B'] for r in rows if r.get('A')=='Holdings:')
    asof=datetime.strptime(label,'As of %d-%b-%Y').date()
    members=[dict(name=r['A'],ticker=r['B'],security_id=r['C']) for r in rows if r.get('H')=='USD' and re.fullmatch(r'[A-Z][A-Z.]{0,7}',r.get('B',''))]
    if len(members)!=30 or len({r['security_id'] for r in members})!=30 or len({r['ticker'] for r in members})!=30:raise ValueError('Expected 30 unique DIA equity holdings')
    return asof,members

def freeze_membership(root):
    """Explicit new revision; retain original membership and selection anchor."""
    at=now();body=(root/'parent-membership.json').read_bytes();m=json.loads(body)
    expected='9d724c0748fc868769cd4c91651155635cf314391d0c95c8abe7b21df98b222e'
    if digest(body)!=expected:raise ValueError('Pinned original membership changed')
    if m['variant']!='membership-v1' or len(m['membership'])!=20:raise ValueError('Original membership required')
    if at>=timestamp(m['issue_deadline']):raise ValueError('Issuance window closed')
    protocol=dict(m,variant='membership-receipt-v2',code_sha256=code_hash(),
        parent_study='company-growth-prospective-20-v1',parent_membership_sha256=digest(body),
        revision_frozen_at=at.isoformat(),
        availability_revision='V2 permits actually received current SEC inventory/calendar and separately identified issuer filing receipts. Unknown inventory publication remains null. Filing acceptance is a separate event, not publication. Financial amounts remain bound to reviewed releases known before issuance.',
        inventory_max_age_seconds=86400,
        cost_assumptions='Offline forecast tool; manually retained free public sources. No paid model calls or orders.',
        input_vintage_rule='Use reviewed current received input vintages; no claim these bytes were unchanged historical originals. Outcome rule remains first public original future result.')
    with_ledger(root,lambda ledger:ledger.register(STUDY+'-members',STUDY,protocol,{STUDY}))
    return protocol


def checked_inventory(root,receipt,body,packet,member,at):
    if receipt.get('evidence_role')!='issuer_filing_inventory' or receipt.get('availability_basis')!='actual_receipt' or 'published_at' not in receipt or receipt['published_at'] is not None:raise ValueError('Inventory requires actual receipt and unknown publication')
    parsed=urlparse(receipt['url'])
    if parsed.hostname!='data.sec.gov' or parsed.path!='/submissions/CIK'+packet['cik'].zfill(10)+'.json' or parsed.query:raise ValueError('Exact official SEC submissions source required')
    received=timestamp(receipt['received_at'])
    if not 0<=(at-received).total_seconds()<=86400:raise ValueError('Fresh inventory receipt within24hours required')
    if receipt.get('inventory_reviewed') is not True:raise ValueError('Manual inventory review required')
    value=json.loads(body)
    if str(value.get('cik','')).zfill(10)!=packet['cik'].zfill(10) or member['ticker'] not in value.get('tickers',[]):raise ValueError('Inventory issuer/security mismatch')
    # First implementation supports reviewed calendar-year reporters only.
    if value.get('fiscalYearEnd')!='1231':raise ValueError('Calendar-year inference unsupported for this issuer')
    rows=value.get('filings',{}).get('recent',{});keys=('form','accessionNumber','filingDate','reportDate','acceptanceDateTime','primaryDocument')
    if any(not isinstance(rows.get(k),list) for k in keys) or len({len(rows[k]) for k in keys})!=1 or not 1<=len(rows['form'])<=2000:raise ValueError('Aligned bounded SEC arrays required')
    financial=[]
    for i,form in enumerate(rows['form']):
        if form not in ('10-Q','10-K','10-Q/A','10-K/A'):continue
        row={k:rows[k][i] for k in keys};report=date.fromisoformat(row['reportDate']);accepted=timestamp(row['acceptanceDateTime']);filed=date.fromisoformat(row['filingDate'])
        if not re.fullmatch(r'\d{10}-\d{2}-\d{6}',row['accessionNumber']) or not row['primaryDocument']:raise ValueError('SEC filing identity required')
        if report>=accepted.date() or report>received.date() or filed>received.date() or accepted>received or accepted>at:raise ValueError('Future or incomplete SEC filing refused')
        financial.append(row)
    if not financial:raise ValueError('Financial filing inventory missing')
    latest=max(financial,key=lambda r:(r['reportDate'],r['acceptanceDateTime']))
    if latest['form'].endswith('/A'):raise ValueError('Latest amendment needs separate accounting review')
    latest_history=max(packet['history'],key=lambda r:period(r)[1])
    if latest_history['end']!=latest['reportDate']:raise ValueError('Latest available financial period omitted')
    for row in packet['fiscal_calendar']+packet['history']:
        q=row['fiscal_quarter'];y=row['fiscal_year'];start=date(y,3*(q-1)+1,1)
        end=(date(y+1,1,1) if q==4 else date(y,3*q+1,1))-timedelta(days=1)
        if period(row)!=(start,end):raise ValueError('Calendar inference does not match December year end')
    return financial

def with_ledger(root,action):
    root.mkdir(parents=True,exist_ok=True);ledger=TrialLedger(root/'panel.sqlite')
    try:return action(ledger)
    finally:ledger.close()
def membership(ledger):
    rows=[r for r in ledger.records() if r['trial_id']==STUDY+'-members']
    if len(rows)!=1:raise ValueError('Freeze membership first')
    return rows[0]['protocol']

def validate_inputs(root,packet,member,at,anchor):
    if set(packet)-{'security_id','cik','mapping_reviewed','definition','target','history','sources','fiscal_calendar','calendar_source_id','fiscal_calendar_reviewed','input_inventory'}:raise ValueError('Unexpected packet fields')
    if packet.get('security_id')!=member['security_id'] or packet.get('mapping_reviewed') is not True:raise ValueError('Reviewed security-to-filer mapping required')
    cik=packet.get('cik')
    if not isinstance(cik,str) or not cik.isdigit() or not 1<=len(cik)<=10 or int(cik)==0:raise ValueError('Original filer CIK required')
    definition=packet['definition']
    if definition!=dict(basis='GAAP',scope='consolidated_three_months',currency='USD',scale='units'):raise ValueError('Explicit USD GAAP quarterly units required')
    start,end=period(packet['target'])
    if start<=at.date():raise ValueError('Target must be a fully future quarter')
    if start>date(2027,4,1):raise ValueError('Target beyond bounded first study window')
    sources=packet['sources']
    if not isinstance(sources,dict) or not 1<=len(sources)<=8:raise ValueError('Bounded source receipts required')
    receipts={};bodies={}
    for key,reference in sources.items():
        safe_id(key);receipt,body=source(root,reference,at)
        if receipt.get('original_filer_cik','').zfill(10)!=cik.zfill(10):raise ValueError('Reviewed issuer identity required')
        role=receipt.get('evidence_role');basis=receipt.get('availability_basis')
        if role=='issuer_filing_inventory':
            checked_inventory(root,receipt,body,packet,member,at)
        elif role=='issuer_filing_evidence':
            if basis!='filing_acceptance_and_receipt' or receipt.get('published_at') is not None or receipt.get('filing_identity_reviewed') is not True:raise ValueError('Distinct filing event/receipt required')
            if timestamp(receipt['filing_accepted_at'])>timestamp(receipt['received_at']):raise ValueError('Filing receipt precedes acceptance')
        else:
            if role!='issuer_quarter_data' or receipt.get('publication_time_reviewed') is not True:raise ValueError('Reviewed quarterly release required')
            published=timestamp(receipt['published_at'])
            if published>timestamp(receipt['received_at']) or published>at:raise ValueError('Source unavailable at issuance')
        receipts[key]=receipt;bodies[key]=body
    inventories=[(r,bodies[k]) for k,r in receipts.items() if r.get('evidence_role')=='issuer_filing_inventory']
    if len(inventories)!=1:raise ValueError('One explicit inventory source required')
    if packet.get('calendar_source_id')!=packet.get('input_inventory',{}).get('source_id'):raise ValueError('Calendar inference must reference reviewed SEC metadata')
    financial=checked_inventory(root,*inventories[0],packet,member,at)
    for receipt in receipts.values():
        if receipt.get('evidence_role')=='issuer_filing_evidence':
            matched=[r for r in financial if r['accessionNumber']==receipt.get('filing_accession')]
            if len(matched)!=1 or timestamp(matched[0]['acceptanceDateTime'])!=timestamp(receipt['filing_accepted_at']) or matched[0]['reportDate']!=receipt.get('filing_report_date'):raise ValueError('Filing receipt not bound to inventory identity/event')
    if packet.get('fiscal_calendar_reviewed') is not True or packet.get('calendar_source_id') not in receipts:raise ValueError('Reviewed fiscal calendar source required')
    calendar=packet.get('fiscal_calendar')
    if not isinstance(calendar,list) or not 2<=len(calendar)<=6:raise ValueError('Bounded consecutive fiscal calendar required')
    calendar=sorted(calendar,key=lambda r:period(r)[0])
    for a,b in zip(calendar,calendar[1:]):
        if period(b)[0]!=period(a)[1]+timedelta(days=1) or ordinal(b)!=ordinal(a)+1:raise ValueError('Fiscal calendar not consecutive')
    covering=[i for i,r in enumerate(calendar) if period(r)[0]<=anchor.date()<=period(r)[1]]
    if len(covering)!=1 or covering[0]+1>=len(calendar) or packet['target']!=calendar[covering[0]+1]:raise ValueError('First future quarter after membership required')
    inventory=packet.get('input_inventory',{})
    if inventory.get('received_versions_reviewed') is not True or inventory.get('source_id') not in receipts:raise ValueError('Latest available filing inventory required')
    if receipts[inventory['source_id']].get('evidence_role')!='issuer_filing_inventory':raise ValueError('Retained filing inventory source required')
    if inventory.get('latest_public_release_reviewed') is not True or inventory.get('latest_release_source_id') not in receipts:raise ValueError('Separate latest-public-release review required')
    if receipts[inventory['latest_release_source_id']].get('evidence_role')!='issuer_quarter_data':raise ValueError('Latest release must reference actual retained release')
    note=inventory.get('release_completeness_note')
    if not isinstance(note,str) or not 1<=len(note)<=600:raise ValueError('Bounded latest-release review note required')
    reviewed=timestamp(inventory.get('reviewed_at'))
    if reviewed>at or reviewed.date()!=at.date():raise ValueError('Current manual inventory review required')
    history=packet['history']
    if not isinstance(history,list) or not 3<=len(history)<=12:raise ValueError('Three to twelve explicit quarterly observations required')
    checked=[]
    for row in history:
        if row.get('amounts_reviewed') is not True or not isinstance(row.get('table_reference'),str) or not 1<=len(row['table_reference'])<=400:raise ValueError('Reviewed original quarter table required')
        first,last=period(row);financial_source=receipts[row['source_id']]
        if financial_source.get('evidence_role')!='issuer_quarter_data':raise ValueError('Financial amounts require reviewed actual release source')
        published=timestamp(financial_source['published_at'])
        if last>=at.date() or last>=start or published.date()<=last or ordinal(row)>=ordinal(packet['target']):raise ValueError('Incomplete or future input quarter')
        revenue=num(row['revenue']);operating=num(row['operating_income'])
        if revenue<=0:raise ValueError('Positive revenue required for margin; never replace company')
        checked.append(dict(row,revenue=str(revenue),operating_income=str(operating)))
    if len({ordinal(r) for r in checked})!=len(checked):raise ValueError('Duplicate fiscal quarter')
    latest=max(checked,key=lambda r:period(r)[1])
    if latest['source_id']!=inventory['latest_release_source_id']:raise ValueError('Latest reviewed release does not supply latest input')
    prior=[r for r in checked if ordinal(r)==ordinal(latest)-4]
    if (inventory.get('latest_available_fiscal_year'),inventory.get('latest_available_fiscal_quarter'))!=(latest['fiscal_year'],latest['fiscal_quarter']):raise ValueError('Newer available quarter omitted')
    seasonal=[r for r in checked if ordinal(r)==ordinal(packet['target'])-4]
    if len(prior)!=1 or len(seasonal)!=1:raise ValueError('Missing year-ago or seasonal quarter')
    if (at.date()-period(latest)[1]).days>180:raise ValueError('Latest supplied quarter stale')
    for a,b in ((latest,prior[0]),(packet['target'],seasonal[0])):
        if not all(300<=(x-y).days<=430 for x,y in zip(period(a),period(b))):raise ValueError('Fiscal seasonal dates misaligned')
    with localcontext() as context:
        context.prec=28
        ratio=num(latest['revenue'])/num(prior[0]['revenue'])
        forecasts=dict(seasonal_no_growth=dict(revenue=str(num(seasonal[0]['revenue'])),margin_pct=str(100*num(seasonal[0]['operating_income'])/num(seasonal[0]['revenue']))),
            growth_persistence=dict(revenue=str(num(seasonal[0]['revenue'])*ratio),margin_pct=str(100*num(latest['operating_income'])/num(latest['revenue']))))
        for values in forecasts.values():
            for value in values.values():num(value)
    return forecasts,receipts

def issue(root,packet):
    at=now()
    def action(ledger):
        m=membership(ledger)
        if m['code_sha256']!=code_hash():raise ValueError('Membership code changed; explicit review/new version required')
        if at>=timestamp(m['issue_deadline']):raise ValueError('Issuance window closed')
        member=next((r for r in m['membership'] if r['security_id']==packet.get('security_id')),None)
        if member is None:raise ValueError('Not a frozen panel member; no substitution')
        forecasts,receipts=validate_inputs(root,packet,member,at,timestamp(m['frozen_at']))
        trial_id=STUDY+'-'+safe_id(member['security_id'])
        protocol=dict(hypothesis=m['hypothesis'],baseline=m['baseline'],split=m['split'],metric=m['metric'],cost_assumptions=m['cost_assumptions'],variant='baselines-receipt-v2',
            code_sha256=code_hash(),data=[dict(id=k,sha256=r['sha256'],availability_basis=r.get('availability_basis','reviewed_release_publication_and_actual_receipt')) for k,r in receipts.items()],
            member=member,packet=packet,receipts=receipts,issued_at=at.isoformat(),forecasts=forecasts,membership_sha256=digest(canonical(m).encode()),
            resolution_deadline=(period(packet['target'])[1]+timedelta(days=180)).isoformat(),resolution_rule=m['resolution_rule'],
            source_limit='Current received input vintages and inferred fiscal calendar are curator reviewed; SEC acceptance is distinct from publication; no denied filing body is claimed retrieved. Hashes prove byte consistency only.')
        if not ledger.register(trial_id,STUDY,protocol,{STUDY}):raise ValueError('Already issued; immutable forecast retained')
        return dict(status='issued',forecasts=forecasts,trial_id=trial_id)
    return with_ledger(root,action)

def score(root,security_id,observation):
    at=now();trial_id=STUDY+'-'+safe_id(security_id)
    def action(ledger):
        row=next((r for r in ledger.records() if r['trial_id']==trial_id),None)
        if not row or row['status']!='registered':raise ValueError('Issued unresolved forecast required')
        p=row['protocol']
        if p['code_sha256']!=code_hash():raise ValueError('Issued code changed; explicit migration/review required')
        if observation is None:return dict(status='pending',reason='Future official result not supplied')
        if observation.get('security_id')!=security_id or observation.get('period')!=p['packet']['target'] or observation.get('definition')!=p['packet']['definition']:raise ValueError('Outcome identity/quarter/basis mismatch')
        receipt,_=source(root,observation['source_receipt'],at)
        published=timestamp(receipt['published_at'])
        if observation.get('amounts_reviewed') is not True or not isinstance(observation.get('table_reference'),str) or not 1<=len(observation['table_reference'])<=400:raise ValueError('Reviewed outcome quarter amounts/table required')
        if receipt.get('first_original_publication_reviewed') is not True or receipt.get('source_version_kind')!='first_public_original':raise ValueError('First original outcome required; revisions refused')
        deadline=date.fromisoformat(p['resolution_deadline'])
        if published.date()>deadline or timestamp(receipt['received_at']).date()>deadline:raise ValueError('Outcome publication/receipt outside frozen deadline')
        if receipt.get('publication_time_reviewed') is not True or receipt.get('original_filer_cik','').zfill(10)!=p['packet']['cik'].zfill(10):raise ValueError('Outcome filer/publication unverified')
        if published>timestamp(receipt['received_at']) or published<=timestamp(p['issued_at']) or published.date()<=period(observation['period'])[1]:raise ValueError('Premature outcome')
        revenue=num(observation['revenue']);raw_operating=observation.get('operating_income')
        if raw_operating is None and (not isinstance(observation.get('operating_income_missing_reason'),str) or not 1<=len(observation['operating_income_missing_reason'])<=400):raise ValueError('Explicit missing operating-income reason required')
        operating=None if raw_operating is None else num(raw_operating)
        if revenue<0:raise ValueError('Negative revenue needs explicit review')
        with localcontext() as context:
            context.prec=28
            margin=None if revenue==0 or operating is None else 100*operating/revenue
            seasonal=num(p['forecasts']['seasonal_no_growth']['revenue'])
            errors={name:dict(revenue_absolute_error_usd=str(abs(num(f['revenue'])-revenue)),revenue_absolute_error_scaled_pct=str(100*abs(num(f['revenue'])-revenue)/seasonal),margin_absolute_error_pp=None if margin is None else str(abs(num(f['margin_pct'])-margin))) for name,f in p['forecasts'].items()}
        result=dict(status='scored_observation',member=p['member'],target=p['packet']['target'],observed_revenue_usd=str(revenue),observed_margin_pct=None if margin is None else str(margin),errors=errors,
            outcome_source_sha256=receipt['sha256'],reviewed_observation=observation,outcome_receipt_snapshot=receipt,
            scored_at=at.isoformat(),alpha_established=False,limitations='One company quarter is not independent evidence or investment alpha. Revisions are not silently substituted. Review declarations do not authenticate source content.')
        body=canonical(result).encode();sha=digest(body);atomic(root/'artifacts'/(sha+'.json'),body)
        ledger.finish(trial_id,'inconclusive','Business baseline observation scored; no skill or investment alpha established',sha,0)
        return result
    return with_ledger(root,action)

def render(root):
    def action(ledger):
        m=membership(ledger);records={r['protocol'].get('member',{}).get('security_id'):r for r in ledger.records() if r['trial_id']!=STUDY+'-members'}
        cards=[];issued=scored=0;scaled={k:[] for k in ('seasonal_no_growth','growth_persistence')};ungradable_margin=0
        for member in m['membership']:
            r=records.get(member['security_id']);status='Needs verified quarterly inputs';detail='No forecast issued. Non-calendar issuers are unsupported in revision2; calendar eligibility must be reviewed per company.'
            if r:
                issued+=1;p=r['protocol'];status='Forecast frozen Ãƒâ€šÃ‚Â· outcome pending'
                detail=f"Target {p['packet']['target']['start']} to {p['packet']['target']['end']}. Issued {p['issued_at']}."
                detail+=' Seasonal sales '+display_money(p['forecasts']['seasonal_no_growth']['revenue'])+' and margin '+format(Decimal(p['forecasts']['seasonal_no_growth']['margin_pct']),'.2f')+'%; growth-persistence sales '+display_money(p['forecasts']['growth_persistence']['revenue'])+' and margin '+format(Decimal(p['forecasts']['growth_persistence']['margin_pct']),'.2f')+'%.'
                if now().date()>date.fromisoformat(p['resolution_deadline']) and not r['outcome']:status='No outcome supplied by deadline Ãƒâ€šÃ‚Â· no score'
                if r['outcome']:
                    sha=r['outcome']['artifact_sha256'];path=root/'artifacts'/(sha+'.json')
                    if not path.exists() or digest(path.read_bytes())!=sha:raise ValueError('Scored artifact missing/changed')
                    scored+=1;result=json.loads(path.read_text());status='Official result scored Ãƒâ€šÃ‚Â· skill unproven';detail+=' Observed revenue $'+result['observed_revenue_usd']+'. Absolute revenue errors: seasonal $'+result['errors']['seasonal_no_growth']['revenue_absolute_error_usd']+', growth persistence $'+result['errors']['growth_persistence']['revenue_absolute_error_usd']+'.'
                    for key in scaled:scaled[key].append(Decimal(result['errors'][key]['revenue_absolute_error_scaled_pct']))
                    ungradable_margin+=result['observed_margin_pct'] is None
            links=''
            if r:
                for key,receipt in r['protocol']['receipts'].items():
                    url=receipt['url'];parsed=urlparse(url)
                    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:raise ValueError('Invalid stored source URL')
                    links+=' <a href="'+html.escape(url,quote=True)+'">'+html.escape('Source '+key)+'</a>'
            cards.append('<tr><td><b>'+html.escape(member['ticker'])+'</b><br>'+html.escape(member['name'])+'</td><td>'+html.escape(status)+'</td><td>'+html.escape(detail)+links+'</td></tr>')
        failure=root/'sources/sec_tickers.failure.json'
        blocker='Other companies still need reviewed source packets. This is protocol revision2; original version1 remains unchanged. Current SEC inventory availability uses actual receipt, with publication unknown. Filing acceptance is recorded separately.'
        if failure.exists():
            f=json.loads(failure.read_text());blocker+=' SEC ticker-mapping capture failed at '+f['attempted_at']+' ('+f['error']+'); no retry. This is a recorded attempt, not a fresh access check.'
        summary='No results yet. The panel cannot establish forecasting skill or investment alpha.'
        if scored:
            means={key:sum(values)/scored for key,values in scaled.items()}
            summary=f"Matched scored set: {scored}/20. Mean revenue absolute error as percent of issued seasonal revenue: seasonal {means['seasonal_no_growth']}%, growth persistence {means['growth_persistence']}%. Ungradable margins: {ungradable_margin}. "+('All20 revenue observations present; still exploratory and correlated.' if scored==20 else 'Missing members remain unknown; no whole-panel verdict.')
        text=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sigil Ãƒâ€šÃ‚Â· Company growth study</title><style>body{{font:16px system-ui;background:#101b21;color:#e6efec;max-width:1150px;margin:auto;padding:28px}}h1{{font-size:34px}}.stats{{display:flex;gap:24px;flex-wrap:wrap;padding:20px;background:#20343b}}.note{{color:#c0d4ce;max-width:850px;line-height:1.55}}table{{border-collapse:collapse;width:100%;margin-top:24px}}td,th{{text-align:left;padding:14px;border-bottom:1px solid #365059;vertical-align:top}}a{{color:#9be3c7}}@media(max-width:650px){{body{{padding:14px}}table,tr,td,th{{display:block}}thead{{display:none}}td{{border:0;padding:8px}}tr{{border-bottom:1px solid #365059;padding:12px 0}}}}</style><h1>Can business growth last?</h1><p class="note">We selected20 companies for forecasts of fully future fiscal quarters. Two simple forecasts ask whether sales stay at last year's level or keep growing at the recent rate. Operating margins are tracked separately. This is a business-forecast study, not a stock recommendation.</p><div class="stats"><b>20 selected</b><b>{issued} forecasts frozen</b><b>{20-issued} need inputs</b><b>{scored} results scored</b></div><p class="note">Membership frozen {html.escape(m['frozen_at'])}. Holdings as of {html.escape(m['source_as_of'])}. Selection: SHA256 of study ID and the source security identifier, after six fixed scope exclusions. No company was chosen for its returns.</p><p class="note">{html.escape(SCOPE)} <a href="{html.escape(m['source_url'],quote=True)}">Official holdings source</a>.</p><p class="note"><b>What is still missing:</b> {html.escape(blocker)} A reviewed issuer mapping, original quarterly amounts and explicit availability times are required before issuance. Missing inputs never cause replacement with an easier company.</p><table><thead><tr><th>Company</th><th>Current state</th><th>What we know</th></tr></thead><tbody>{''.join(cards)}</tbody></table><p class="note">As of {now().isoformat()}. Forecasts are immutable local records; this is not a third-party preregistration. Source hashes check retained bytes, not authenticity. Companies and quarters can share exposures. Twenty observations cannot establish alpha.</p></html>'''
        text=text.replace('<table><thead>', '<p class="note">'+html.escape(summary)+'</p><table><thead>')
        (root/'index.html').write_text(text,encoding='utf-8')
        return dict(selected=20,issued=issued,needs_inputs=20-issued,scored=scored,view=str(root/'index.html'))
    return with_ledger(root,action)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['freeze','issue','score','view','record-source']);parser.add_argument('--packet');parser.add_argument('--security-id')
    for key in ('source-id','file','url','published-at','cik','role'):parser.add_argument('--'+key)
    parser.add_argument('--reviewed',action='store_true');parser.add_argument('--first-original',action='store_true');args=parser.parse_args()
    if args.action=='freeze':result=freeze_membership(ROOT)
    elif args.action=='issue':result=issue(ROOT,json.loads(Path(args.packet).read_text()))
    elif args.action=='score':result=score(ROOT,args.security_id,None if not args.packet else json.loads(Path(args.packet).read_text()))
    elif args.action=='record-source':result=record_source(ROOT,args.source_id,args.file,args.url,args.published_at,args.cik,args.role,args.reviewed,args.first_original)
    else:result=render(ROOT)
    print(json.dumps(result,indent=2))
