"""Leakage-aware location demand baselines. No traffic source or neural model implied."""
import math,json,hashlib
from datetime import date
from .receipts import stamp,canonical
from .supply_procurement import finite

def solve(a,b):
    n=len(b);m=[list(row)+[v] for row,v in zip(a,b)]
    for i in range(n):
        p=max(range(i,n),key=lambda k:abs(m[k][i]));m[i],m[p]=m[p],m[i]
        if abs(m[i][i])<1e-12:raise ValueError('Singular baseline design')
        z=m[i][i];m[i]=[v/z for v in m[i]]
        for j in range(n):
            if j!=i:
                z=m[j][i];m[j]=[x-z*y for x,y in zip(m[j],m[i])]
    return [r[-1] for r in m]

def location_baselines(observations,target,decision_at,*,ridge=1.,minimum_training=8):
    """Fit only training labels received before decision; target label is never read."""
    cutoff=stamp(decision_at)
    if type(minimum_training) is not int or minimum_training<3 or len(observations)>10000:raise ValueError('Bounded training rows required')
    if not finite(ridge) or ridge<=0:raise ValueError('Positive fixed ridge required')
    if not isinstance(target,dict) or not isinstance(target.get('unit_id'),str):raise ValueError('Target identity missing')
    target_period=date.fromisoformat(target['period_end']);target_features=target['features']
    if not isinstance(target_features,list) or not target_features or not all(finite(v) for v in target_features):raise ValueError('Finite fixed feature vector required')
    if stamp(target['features_available_at'])>=cutoff:raise ValueError('Target features not available before decision')
    if target_period<=cutoff.date():raise ValueError('Target period must be future')
    names=target.get('feature_names')
    if not isinstance(names,list) or len(names)!=len(target_features) or len(names)>8 or len(set(names))!=len(names) or not all(isinstance(x,str) and x for x in names):raise ValueError('Fixed named feature schema required')
    semantics=['label_definition','label_unit','geography_version','membership_version']
    if not all(isinstance(target.get(k),str) and target[k] for k in semantics):raise ValueError('Label/geography/membership definitions required')
    dimension=len(target_features);train=[];seen=set();evidence=set()
    for row in observations:
        period=date.fromisoformat(row['period_end']);identity=(row['unit_id'],period)
        if identity in seen:raise ValueError('Duplicate unit-period requires version selection')
        seen.add(identity)
        if row['unit_id']!=target['unit_id']:continue # no geographic pooling without predeclared design
        if period>=target_period or stamp(row['features_available_at'])>=cutoff or stamp(row['label_available_at'])>=cutoff:continue
        historical_decision=stamp(row['forecast_decision_at'])
        if stamp(row['features_available_at'])>=historical_decision or historical_decision.date()>=period:raise ValueError('Historical features were unavailable for their forecast')
        if row.get('feature_names')!=names or any(row.get(k)!=target[k] for k in semantics):raise ValueError('Feature/label/geography definitions changed')
        xs=row['features'];y=row['label']
        if period>=stamp(row['label_available_at']).date():raise ValueError('Label must follow completed observation period')
        if not isinstance(xs,list) or len(xs)!=dimension or not all(finite(v) for v in xs) or not finite(y):raise ValueError('Invalid observations')
        if row.get('evidence_kind') not in ('synthetic_fixture','verified_point_in_time_labels'):raise ValueError('Label provenance not declared')
        evidence.add(row['evidence_kind']);train.append(row)
    if not train:return dict(status='blocked_no_available_labels',n=0,input_n=len(observations),excluded_n=len(observations),persistence=None,seasonal=None,linear=None,lstm='not_fit')
    if len(evidence)!=1:raise ValueError('Do not mix fixtures and real evidence')
    if target.get('evidence_kind') not in evidence:raise ValueError('Target/training evidence mismatch')
    train.sort(key=lambda x:x['period_end']);persistence=train[-1]['label']
    same_month=[x for x in train if x['period_end'][5:7]==target['period_end'][5:7]]
    seasonal=same_month[-1]['label'] if same_month else None
    result=dict(status='baselines_only',n=len(train),input_n=len(observations),excluded_n=len(observations)-len(train),persistence=persistence,seasonal=seasonal,linear=None,lstm='not_fit',evidence_kind=next(iter(evidence)),decision_at=decision_at,training_sha256=hashlib.sha256(canonical(train)).hexdigest(),target_period=target['period_end'])
    if len(train)<max(minimum_training,dimension+2):result['linear_status']='insufficient_training';return result
    means=[sum(x['features'][j] for x in train)/len(train) for j in range(dimension)]
    scales=[math.sqrt(sum((x['features'][j]-means[j])**2 for x in train)/len(train)) or 1. for j in range(dimension)]
    design=[[1.]+[(x['features'][j]-means[j])/scales[j] for j in range(dimension)] for x in train];ys=[x['label'] for x in train]
    k=dimension+1;a=[[sum(x[i]*x[j] for x in design)+(ridge if i==j and i else 0) for j in range(k)] for i in range(k)];b=[sum(x[i]*y for x,y in zip(design,ys)) for i in range(k)]
    beta=solve(a,b);features=[1.]+[(target_features[j]-means[j])/scales[j] for j in range(dimension)]
    model=dict(means=means,scales=scales,beta=beta,ridge=ridge,feature_names=names,semantics={k:target[k] for k in semantics})
    result.update(linear=sum(x*y for x,y in zip(beta,features)),linear_status='fit_training_only',model_sha256=hashlib.sha256(canonical(model)).hexdigest(),model=model)
    return result
