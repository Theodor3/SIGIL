import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Optional existing Playwright installation; no downloads or production endpoints.
const { chromium } = await import(process.env.SIGIL_PLAYWRIGHT_MODULE || 'playwright');
const dist=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const fixture={status:'ok',view:'overview',signals:[],signal_groups:{},top_ideas:[],recent_runs:[],
 portfolio:{is_demo:true},pipeline:{last_run:'2024-01-01T00:00:00Z',status:'completed',run_id:'synthetic-run',universe_size:2,duration:1},
 regime:{regime_id:'risk_on',confidence:.7,exposure:.75,factor_tilts:{},vol_state:'normal',breadth_state:'mixed',indicators:{},history:[]}};

test('overview loads lightweight data, retains dated content on refresh failure and recovers',async()=>{
 let release;const gate=new Promise(r=>release=r);let requests=0;const methods=[];let badRequest=false;
 const server=createServer(async(req,res)=>{
  methods.push(req.method);const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/auth/check'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({auth_required:false,authenticated:true}));return;}
  if(url.pathname==='/api/dashboard-data'){
   if(url.searchParams.get('view')!=='overview')badRequest=true;
   requests++; if(requests===1)await gate;
   res.setHeader('Content-Type','application/json');
   if(requests===2 || requests===4){res.statusCode=503;res.end('{}');}else res.end(JSON.stringify(fixture));return;
  }
  const file=url.pathname.startsWith('/assets/')?resolve(dist,'.'+url.pathname):resolve(dist,'index.html');
  if(!file.startsWith(dist)){res.statusCode=400;res.end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.js'?'application/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(readFileSync(file));}
  catch{res.statusCode=404;res.end();}
 });
 server.on('upgrade',(_req,socket)=>socket.destroy());
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try { browser=await chromium.launch({headless:true,executablePath:process.env.SIGIL_CHROMIUM_EXECUTABLE || undefined}); }
 catch(error) { server.closeAllConnections();await new Promise(r=>server.close(r));throw error; }
 try{
  const page=await browser.newPage();await page.clock.install();
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.getByRole('status').filter({hasText:'Loading pipeline'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Overview',exact:true}).count(),1);
  await page.clock.runFor(60_002);assert.equal(requests,1,'polls must not overlap the pending fetch');
  release();await page.getByRole('heading',{name:'Data provenance',exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/2024-01-01T00:00:00.000Z/);
  await page.clock.runFor(30_001);await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Showing the last successful overview/);
  assert.equal(await page.getByRole('heading',{name:'Data provenance',exact:true}).count(),1);
  await page.clock.runFor(30_001);
  await page.getByRole('alert').waitFor({state:'detached'});
  assert.equal(requests,3);assert.equal(badRequest,false);assert.ok(methods.every(m=>m==='GET'));
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Error: HTTP 503/);
  assert.equal(await page.getByRole('heading',{name:'Data provenance',exact:true}).count(),0);
  await page.clock.runFor(30_001);await page.getByRole('heading',{name:'Data provenance',exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/Configured account mode: synthetic demo/);
 }finally{release();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
