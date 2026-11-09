"""Synthetic recovery packet shared by isolated tests; no service access."""
import hashlib
import json


def fixture():
    source=json.dumps({'timeframe':'1D','timestamp':[1791590400],'equity':[100]}).encode()
    sha=hashlib.sha256(source).hexdigest()
    point={'provider_epoch':1791590400,'provider_label_utc':'2026-10-10T00:00:00Z','equity':100,
        'date_index':'2026-10-09','date_status':'proposed_session_date','valuation_at':None,'resolution':'daily','source_sha256':sha}
    view={'kind':'read_only_provider_daily_view','source_sha256':sha,'comparison_allowed':False,'metrics':None,
        'separate_from_hourly_snapshots':True,'retrieved_at':'2026-11-03T17:08:47Z','points':[point],
        'private_path':'not_to_serve','account_id':'not_to_serve'}
    return view,source
