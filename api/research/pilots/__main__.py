import argparse,json
from pathlib import Path
from .receipts import capture
from .supply_procurement import normalize,duration_baseline,conversion_baseline,observed_panel
from .location import location_baselines

def main():
    p=argparse.ArgumentParser(description='Manual local research only; no trades or schedules')
    sub=p.add_subparsers(dest='command',required=True)
    c=sub.add_parser('capture');c.add_argument('source',choices=['fda','procurement']);c.add_argument('--out',required=True)
    n=sub.add_parser('normalize');n.add_argument('receipt');n.add_argument('--out',required=True)
    for name in ['location-baseline','duration-baseline','conversion-baseline']:
        b=sub.add_parser(name);b.add_argument('packet')
    h=sub.add_parser('observed-panel');h.add_argument('source',choices=['fda','procurement']);h.add_argument('--out',required=True)
    args=p.parse_args()
    if args.command=='capture':print(json.dumps({'receipt':capture(args.out,args.source),'kind':'current_capture_not_historical'}))
    elif args.command=='normalize':print(json.dumps(normalize(args.out,args.receipt),indent=2))
    elif args.command=='observed-panel':print(json.dumps(observed_panel(args.out,args.source),indent=2))
    else:
        if Path(args.packet).stat().st_size>1_000_000:raise ValueError('Packet too large')
        data=json.loads(Path(args.packet).read_text())
        if args.command=='location-baseline':result=location_baselines(data['observations'],data['target'],data['decision_at'])
        elif args.command=='duration-baseline':result=duration_baseline(data['episodes'],data['decision_at'],data.get('horizon_days',30))
        else:result=conversion_baseline(data['training'],data['decision_at'])
        print(json.dumps(result,indent=2))
if __name__=='__main__':main()
