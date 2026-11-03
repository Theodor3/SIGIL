"""Prepare a bounded, source-bound separate daily view. No DB/broker imports."""
import hashlib
import json
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

MAX_BYTES = 256_000


class PreparedRecovery:
    def __init__(self, view_bytes, source_bytes, *, receipt, expected_account_fingerprint):
        if any(not isinstance(b, bytes) or len(b)>MAX_BYTES for b in (view_bytes,source_bytes)):
            raise ValueError('bounded_private_source_required')
        def reject(_):raise ValueError('nonfinite_json')
        view=json.loads(view_bytes,parse_constant=reject)
        source=json.loads(source_bytes,parse_constant=reject)
        if not isinstance(view,dict) or not isinstance(source,dict):
            raise ValueError('object_sources_required')
        sha=hashlib.sha256(source_bytes).hexdigest()
        if (not isinstance(receipt,dict) or receipt.get('paper_account_match') is not True
            or receipt.get('endpoint')!='https://paper-api.alpaca.markets/v2/account/portfolio/history'
            or receipt.get('sha256')!=sha or receipt.get('query',{}).get('timeframe')!='1D'
            or not isinstance(expected_account_fingerprint,str) or len(expected_account_fingerprint)!=64
            or any(c not in '0123456789abcdef' for c in expected_account_fingerprint)
            or receipt.get('account_fingerprint')!=expected_account_fingerprint):
            raise ValueError('verified_paper_account_binding_required')
        if (view.get('kind')!='read_only_provider_daily_view' or view.get('source_sha256')!=sha
            or view.get('comparison_allowed') is not False or view.get('metrics') is not None
            or view.get('separate_from_hourly_snapshots') is not True or source.get('timeframe')!='1D'):
            raise ValueError('unsupported_recovery_contract')
        retrieved=datetime.fromisoformat(view['retrieved_at'].replace('Z','+00:00'))
        if retrieved.tzinfo is None or retrieved>datetime.now(timezone.utc):
            raise ValueError('invalid_receipt_time')
        if datetime.fromisoformat(receipt['retrieved_at'].replace('Z','+00:00'))!=retrieved:
            raise ValueError('receipt_time_mismatch')
        stamps,values=source.get('timestamp'),source.get('equity')
        if not isinstance(stamps,list) or not isinstance(values,list) or not 1<=len(stamps)<=1000 or len(stamps)!=len(values):
            raise ValueError('invalid_source_arrays')
        indexed={};previous=-1
        for epoch,value in zip(stamps,values):
            if type(epoch) is not int or epoch<=previous or epoch in indexed or type(value) not in (int,float) or not math.isfinite(value) or value<=0:
                raise ValueError('invalid_or_duplicate_source')
            indexed[epoch]=value;previous=epoch
        points=view.get('points')
        if not isinstance(points,list) or not 1<=len(points)<=1000:
            raise ValueError('invalid_points')
        rows=[];dates=set();epochs=set()
        for point in points:
            if not isinstance(point,dict):raise ValueError('invalid_point')
            epoch=point.get('provider_epoch')
            if type(epoch) is not int or epoch not in indexed or epoch in epochs:
                raise ValueError('duplicate_or_unknown_label')
            stamp=datetime.fromtimestamp(epoch,timezone.utc)
            date=stamp.astimezone(ZoneInfo('America/New_York')).date().isoformat()
            supplied=datetime.fromisoformat(point['provider_label_utc'].replace('Z','+00:00'))
            if (supplied.tzinfo is None or supplied!=stamp or stamp>retrieved or date in dates
                or point.get('date_index')!=date or point.get('date_status')!='proposed_session_date'
                or point.get('valuation_at') is not None or point.get('resolution')!='daily'
                or type(point.get('equity')) not in (int,float) or point['equity']!=indexed[epoch]
                or point.get('source_sha256')!=sha):
                raise ValueError('inconsistent_daily_observation')
            dates.add(date);epochs.add(epoch)
            rows.append({'date_index':date,'provider_epoch':epoch,'provider_label_utc':stamp.isoformat(),
                         'equity':indexed[epoch],'valuation_at':None,'resolution':'daily'})
        rows.sort(key=lambda p:p['provider_epoch'])
        self._body=json.dumps({'schema_version':1,'available':True,'series_id':'recovered_daily_separate',
            'source_label':'Alpaca paper account history','source_sha256':sha,'retrieved_at':retrieved.isoformat(),
            'date_mapping':'proposed_New_York_session_date_not_verified_valuation',
            'valuation_time_known':False,'comparison_allowed':False,'metrics':None,
            'separate_from_hourly':True,'points':rows,
            'limitations':['Private manually captured source; byte matching does not independently authenticate origin.',
                'Daily observations are not hourly snapshots; no merging, deduplication against hourly records or interpolation.',
                'Proposed session dates and unknown valuation times do not support synchronized returns or alpha.']},
            allow_nan=False,separators=(',',':'))

    def response(self):
        return json.loads(self._body)
