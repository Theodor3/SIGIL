import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.SIGIL_PLAYWRIGHT_MODULE || 'playwright');
const dist=resolve('dist');
test('offline stock home: keyboard selection, voting, filters, empty/error states, mobile and no API calls',async()=>{
 const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;const file=path==='/stock-home-preview'?resolve('preview-artifacts/sigil-stock-home-preview.html'):path.startsWith('/assets/')?resolve(dist,'.'+path):resolve(dist,'index.html');if(path!=='/stock-home-preview'&&!file.startsWith(dist)){res.writeHead(400);res.end();return}try{res.setHeader('Content-Type',extname(file)==='.js'?'application/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.SIGIL_CHROMIUM_EXECUTABLE || undefined});const page=await browser.newPage({viewport:{width:1440,height:1000}});const forbidden=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{const u=r.request().url();if(!u.startsWith(origin)||u.includes('/api/')||u.includes('/ws')){forbidden.push(u);return r.abort()}return r.continue()});
 await page.goto(origin+'/stock-home-preview');await page.getByRole('heading',{name:'Stock ideas',exact:true}).waitFor();
 const row=page.getByRole('button',{name:/2 DEMO-B/});await row.focus();await page.keyboard.press('Enter');assert.equal(await row.getAttribute('aria-pressed'),'true');await page.getByRole('heading',{name:'DEMO-B / Behind the score'}).waitFor();
 await page.getByText('Missing inputs and scoring limits',{exact:true}).click();assert.match(await page.locator('body').innerText(),/per-program input dates/);
 const vote=page.getByRole('button',{name:'Vote for this idea'}).first();await vote.click();assert.equal(await page.getByRole('button',{name:'Voted · Undo'}).count(),1);assert.equal(await row.getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:'Voted · Undo'}).click();
 await page.getByRole('button',{name:'negative',exact:true}).click();assert.equal(await page.locator('.home-research-grid article').count(),2);await page.getByRole('button',{name:'All findings',exact:true}).click();assert.equal(await page.locator('.home-research-grid article').count(),6);
 await page.getByLabel('Preview state').selectOption('legacy_unavailable');assert.equal(await page.locator('.home-stock-row').count(),0);await page.getByLabel('Preview state').selectOption('error');assert.match(await page.getByRole('alert').innerText(),/last successful/);await page.getByLabel('Preview state').selectOption('saved');
 mkdirSync('preview-artifacts',{recursive:true});await page.screenshot({path:'preview-artifacts/stock-home-desktop.png',fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);}
 await page.screenshot({path:'preview-artifacts/stock-home-mobile.png',fullPage:true});await page.reload();assert.equal(await page.getByRole('button',{name:'Voted · Undo'}).count(),0);assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
