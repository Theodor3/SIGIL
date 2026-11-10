import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.SIGIL_PLAYWRIGHT_MODULE || 'playwright');
const dist=resolve('dist');
test('connected home uses read-only summary, keeps research through errors, retries and links selected ticker',async()=>{
 let fail=false;let hold=false;let release;const calls=[];
 const fixture={score_status:'saved',top_ideas:[{rank:1,ticker:'DEMO',final_score:0,signal_scores:{value:0},gate_flags:{confidence:false}}],pipeline:{run_id:'fixture-run',last_run:'2026-11-01T00:00:00Z',status:'completed'}};
 const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost');calls.push([req.method,path.pathname+path.search]);
 if(path.pathname==='/api/auth/check'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({auth_required:false}));return;}
 if(path.pathname==='/api/dashboard-data'){if(hold)await new Promise(r=>release=r);assert.equal(path.search,'?view=overview');res.setHeader('Content-Type','application/json');res.statusCode=fail?503:200;res.end(JSON.stringify(fixture));return;}
 if(path.pathname==='/api/research/top-ideas'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ideas:[],score_status:'saved'}));return;}
 if(path.pathname.startsWith('/api/research/ticker/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ticker:decodeURIComponent(path.pathname.split('/').at(-1)),company:{},final_score:0,score_status:'saved',confidence:0,signals:[],score_history:[],evaluations:[],trades:[],run_date:null}));return;}
 if(path.pathname==='/api/watchlist'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tickers:[]}));return;}
 if(path.pathname.startsWith('/api/')){res.writeHead(503);res.end('{}');return;}
 const file=path.pathname.startsWith('/assets/')?resolve(dist,'.'+path.pathname):resolve(dist,'index.html');try{res.setHeader('Content-Type',extname(file)==='.js'?'application/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});
 server.on('upgrade',(_req,socket)=>socket.destroy());await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.SIGIL_CHROMIUM_EXECUTABLE||undefined});const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);await page.getByRole('heading',{name:'DEMO / Behind the score'}).waitFor();
 assert.match(await page.locator('.home-score').innerText(),/0.00/);assert.match(await page.locator('.home-stock-row').innerText(),/not met/);
 assert.equal(await page.getByRole('link',{name:'Open company research and score history'}).getAttribute('href'),'/research?ticker=DEMO');
 hold=true;await page.getByRole('button',{name:'Refresh saved view'}).click();await page.getByRole('status').filter({hasText:'Refreshing the saved view'}).waitFor();assert.equal(await page.getByRole('button',{name:'Refreshing saved view…'}).isDisabled(),true);assert.equal(await page.locator('.home-stock-row').count(),1);hold=false;release();await page.getByRole('button',{name:'Refresh saved view'}).waitFor();
 fail=true;await page.getByRole('button',{name:'Refresh saved view'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/last successful/);assert.equal(await page.locator('.home-stock-row').count(),1);
 await page.reload();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.home-stock-row').count(),0);assert.equal(await page.locator('.home-research-grid article').count(),6);
 fail=false;await page.getByRole('button',{name:'Refresh saved view'}).click();await page.getByRole('heading',{name:'DEMO / Behind the score'}).waitFor();
 await page.setViewportSize({width:600,height:320});const mobile=page.locator('nav').filter({has:page.locator('summary')});await mobile.locator('summary').click();assert.equal(await mobile.locator('details').getAttribute('open'),'');await mobile.getByRole('link',{name:'Company research'}).click();assert.equal(await mobile.locator('details').getAttribute('open'),null);await page.goBack();await page.getByRole('heading',{name:'Stock ideas',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.getByRole('link',{name:'Open company research and score history'}).click();await page.getByPlaceholder('Enter ticker (e.g. AAPL, MSFT, NVDA)').waitFor();
 await page.getByPlaceholder('Enter ticker (e.g. AAPL, MSFT, NVDA)').fill('msft');await page.getByPlaceholder('Enter ticker (e.g. AAPL, MSFT, NVDA)').press('Enter');await page.waitForURL('**/research?ticker=MSFT');
 await page.reload();await page.waitForFunction(()=>document.querySelector('input[placeholder^="Enter ticker"]')?.value==='MSFT');
 await page.goBack();await page.waitForURL('**/research?ticker=DEMO');await page.waitForFunction(()=>document.querySelector('input[placeholder^="Enter ticker"]')?.value==='DEMO');
 await page.goForward();await page.waitForURL('**/research?ticker=MSFT');assert.ok(calls.every(([method])=>method==='GET'));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
