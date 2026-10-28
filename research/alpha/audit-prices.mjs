// Offline receipt audit and outcome export. Never manufactures forecast times.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function auditPrices(inputs, horizonDays=20) {
  if (!Number.isInteger(horizonDays) || horizonDays < 1) throw new Error('Positive calendar horizon required');
  const series = {}, sources = [], excluded = {};
  for (const { receipt, bytes } of inputs) {
    if (!receipt || typeof receipt.symbol !== 'string' || series[receipt.symbol]) throw new Error('Missing/duplicate symbol');
    if (sha256(bytes) !== receipt.sha256) throw new Error(`Receipt hash mismatch: ${receipt.symbol}`);
    if (typeof receipt.retrievedAt!=='string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.retrievedAt) || !Number.isFinite(Date.parse(receipt.retrievedAt))) throw new Error('Zoned retrieval time required');
    const chart = JSON.parse(bytes).chart;
    if (chart.error || chart.result?.length !== 1) throw new Error('Invalid chart response');
    const result = chart.result[0];
    if(result.meta.symbol !== receipt.symbol) throw new Error('Provider symbol mismatch');
    const times=result.timestamp, prices=result.indicators.adjclose[0].adjclose;
    if (!Array.isArray(times) || times.length !== prices.length) throw new Error('Price/time length mismatch');
    const map=new Map(); let missing=0, incomplete=0;
    for(let i=0; i<times.length; i++) {
      if(!Number.isFinite(times[i])) throw new Error('Invalid observation timestamp');
      const day=new Date(times[i]*1000).toISOString().slice(0,10);
      const retrievedDay=new Date(receipt.retrievedAt).toISOString().slice(0,10);
      if(day > retrievedDay) throw new Error('Future observation');
      if(day === retrievedDay) {incomplete++;continue;}
      if(map.has(day)) throw new Error('Duplicate date');
      if(typeof prices[i] !== 'number' || !Number.isFinite(prices[i]) || prices[i] <= 0) {missing++; continue;}
      map.set(day,prices[i]);
    }
    series[receipt.symbol]=map;
    const dates=[...map.keys()].sort();
    sources.push({...receipt,bytes:bytes.length,hashVerified:true,observations:dates.length,missingPrices:missing,incompleteDateExcluded:incomplete,first:dates[0]??null,last:dates.at(-1)??null});
  }
  if(!series.SPY) throw new Error('SPY benchmark required');
  const outcomes=[];
  for(const [symbol, map] of Object.entries(series)) {
    if(symbol==='SPY') continue;
    excluded[symbol]={missingExactExit:0,missingBenchmark:0};
    for(const day of [...map.keys()].sort()) {
      const exit=new Date(Date.parse(day+'T00:00:00Z')+horizonDays*86400000).toISOString().slice(0,10);
      if(!map.has(exit)) {excluded[symbol].missingExactExit++;continue;}
      if(!series.SPY.has(day)||!series.SPY.has(exit)) {excluded[symbol].missingBenchmark++;continue;}
      const stockReturn=map.get(exit)/map.get(day)-1, benchmarkReturn=series.SPY.get(exit)/series.SPY.get(day)-1;
      if(!Number.isFinite(stockReturn)||!Number.isFinite(benchmarkReturn)) throw new Error('Nonfinite derived return');
      outcomes.push({symbol,entryDate:day,exitDate:exit,stockReturn,benchmarkReturn,
        evidenceKind:'current_vintage_adjusted_close_outcome_only',pointInTimeForecastEligible:false});
    }
  }
  return {schemaVersion:1,horizonCalendarDays:horizonDays,sources,excluded,outcomes,
    originalForecasts:0,pointInTimeForecastEligible:false,
    limitations:['No original forecasts or forecast creation timestamps in these price archives.',
      'Current-vintage adjusted prices are retrospective outcome evidence, not executable fills or historical source vintages.',
      'Exact calendar exit dates exclude non-session dates; missingExactExit includes immature windows and missing sessions.',
      'Selected ETF universe cannot establish coverage of the equity strategy, delistings or prior candidate searches.']};
}

export function saveImmutable(value, directory) {
  const bytes=Buffer.from(JSON.stringify(value)+'\n'), hash=sha256(bytes);
  mkdirSync(directory,{recursive:true});
  const file=join(directory,hash+'.json');
  if(existsSync(file)) {
    if(sha256(readFileSync(file))!==hash) throw new Error('Existing content-addressed export was modified');
  } else writeFileSync(file,bytes,{flag:'wx'});
  return {file,sha256:hash,bytes:bytes.length,outcomes:value.outcomes.length,originalForecasts:value.originalForecasts};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [sourceDir,outputDir]=process.argv.slice(2);
  if(!sourceDir||!outputDir) throw new Error('Usage: audit-prices.mjs ARCHIVE_DIR LOCAL_OUTPUT_DIR');
  const receipts=JSON.parse(readFileSync(join(sourceDir,'diversified-results-2026-10-27.json'),'utf8')).datasetReceipts;
  const result=auditPrices(receipts.map(receipt=>({receipt,bytes:readFileSync(join(sourceDir,`diversified-${receipt.symbol}-2026-10-27.json`))})));
  console.log(JSON.stringify({...saveImmutable(result,outputDir),sources:result.sources,excluded:result.excluded},null,2));
}

