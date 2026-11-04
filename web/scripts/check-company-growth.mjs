/** Offline publication guard. No API, model, broker or account access. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function verifyCompanyGrowth(manifest,bytes,html){
 const fail=message=>{throw Error(message);};
 if(manifest.schemaVersion!==1||manifest.publicationMode!=='reviewed_frozen_snapshot'||manifest.status!=='pending_outcome'||manifest.issuedCompanies!==1||manifest.scoredCompanies!==0)fail('Unknown publication state');
 if(bytes.length>100000||sha(bytes)!==manifest.forecastSha256)fail('Frozen forecast bytes changed');
 const f=JSON.parse(bytes);
 if(f.variant!=='baselines-receipt-v2'||f.code_sha256!==manifest.codeSha256||f.issued_at!==manifest.issuedAt||JSON.stringify(f.packet.target)!==JSON.stringify(manifest.target))fail('Publication differs from frozen record');
 if(f.member.ticker!=='BA'||f.member.security_id!=='097023105'||!Number.isFinite(Date.parse(f.issued_at))||!(Date.parse(f.packet.target.start)>Date.parse(f.issued_at)))fail('Future target and company identity required');
 if(f.receipts.inventory.published_at!==null||f.receipts.inventory.availability_basis!=='actual_receipt'||f.receipts.q1_filing.published_at!==null||!f.receipts.q1_filing.filing_accepted_at)fail('Availability times conflated');
 const hosts=new Set(['data.sec.gov','www.prnewswire.com','s2.q4cdn.com']);
 for(const r of Object.values(f.receipts)){const u=new URL(r.url);if(u.protocol!=='https:'||u.username||u.password||!hosts.has(u.hostname))fail('Unsafe public source');}
 if(!html.includes('1 forecasts frozen')||!html.includes('19 need inputs')||!html.includes('0 results scored')||!html.includes('outcome pending')||!html.includes(f.packet.target.start)||!html.includes(f.packet.target.end)||!html.includes(f.issued_at))fail('Displayed state differs from issued record');
 for(const forecast of Object.values(f.forecasts)){
  const revenue=Number(forecast.revenue),margin=Number(forecast.margin_pct);
  if(!Number.isFinite(revenue)||!Number.isFinite(margin)||!html.includes('$'+(revenue/1e9).toFixed(3)+' billion')||!html.includes(margin.toFixed(2)+'%'))fail('Displayed baseline differs from issued record');
 }
 const combined=html+bytes.toString();
 if(/<script\b|file:\/\/|127\.0\.0\.1|localhost|C:[\\/]Users[\\/]|BEGIN [A-Z ]*PRIVATE KEY/i.test(combined)||html.includes('/api/'))fail('Executable content or private material in public snapshot');
 return {status:'pending_outcome',issuedAt:f.issued_at,target:f.packet.target,forecastSha256:manifest.forecastSha256,externalSourcesAuthenticated:false};
}
export function run(){
 const root=new URL('../public/research/company-growth/',import.meta.url);
 return verifyCompanyGrowth(JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')),readFileSync(new URL('forecast.json',root)),readFileSync(new URL('index.html',root),'utf8'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
