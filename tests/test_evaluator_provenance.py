import asyncio
from datetime import date,datetime
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from sqlalchemy import select
from api.db.models import Base,PipelineRun,SignalPrediction,SignalEvaluation
from api.tracker import evaluator as ev

def test_batch_preserves_legacy_and_uses_decision_not_run_date(monkeypatch):
 async def run():
  engine=create_async_engine('sqlite+aiosqlite:///:memory:')
  async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
  session=async_sessionmaker(engine,expire_on_commit=False)
  monkeypatch.setattr(ev,'completed_market_date',lambda:date(2026,10,10))
  monkeypatch.setattr(ev,'verify_snapshot_reference',lambda _:True)
  history={'ABC':([date(2026,10,d) for d in [1,2,5,6,7,8,9]],[1,10,12,15,20,25,30]),'SPY':([date(2026,10,d) for d in [1,2,5,6,7,8,9]],[100]*7)}
  history['ZERO']=(history['SPY'][0],[100]*7)
  monkeypatch.setattr(ev,'_download_history_sync',lambda *a:history)
  def metadata(day):
   stamp=f'2026-10-{day:02}T22:00:00+00:00'
   ref=dict(context_sha256='a'*64,receipt_sha256='b'*64,captured_at=stamp,run_id='run',snapshot_id='c'*32)
   return {'_sigil_provenance':dict(evaluation_protocol='post_decision_daily_v1',decision_at=stamp,input_available_at=stamp,context_snapshot=ref)}
  async with session() as db:
   db.add(PipelineRun(id='run',started_at=datetime(2026,10,1),status='completed'))
   db.add_all([SignalPrediction(id=i,run_id='run',run_date=date(2026,10,1),signal_name='test'+str(i),ticker='ABC',score=.8,confidence=1,metadata_=m) for i,m in [(1,None),(2,metadata(1)),(3,metadata(8))]])
   db.add(SignalPrediction(id=4,run_id='run',run_date=date(2026,10,1),signal_name='bearish-zero',ticker='ZERO',score=.2,confidence=1,metadata_=metadata(1)))
   db.add(SignalEvaluation(prediction_id=1,horizon_days=5,actual_return=.99,evaluated_at=datetime(2020,1,1)))
   await db.commit()
   await ev._evaluate_batch(db,5)
   rows=(await db.execute(select(SignalEvaluation).order_by(SignalEvaluation.prediction_id))).scalars().all()
   assert len(rows)==3 and rows[0].actual_return==.99
   assert rows[1].prediction_id==2 and rows[1].actual_return==.5 and rows[1].alpha_vs_benchmark==.5
   assert rows[2].prediction_id==4 and rows[2].signal_correct is False
   # Old run_date with recent decision must not get shortened permanent evaluation.
   assert not any(r.prediction_id==3 for r in rows)
  await engine.dispose()
 asyncio.run(run())

def test_evaluation_cycle_never_runs_historical_cleanup(monkeypatch):
 async def forbidden(*a):raise AssertionError('Historical mutation called')
 async def empty(*a):return {'evaluated':0,'marked_ungradable':0}
 monkeypatch.setattr(ev,'_purge_simulated_evaluations',forbidden)
 monkeypatch.setattr(ev,'_reclassify_neutral_evaluations',forbidden)
 monkeypatch.setattr(ev,'_evaluate_batch',empty)
 assert asyncio.run(ev.evaluate_predictions(None))['evaluated']==0
