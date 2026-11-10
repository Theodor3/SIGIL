
// Preview server intentionally refuses every API route and websocket upgrade.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const dist=resolve(import.meta.dirname,'../dist');
createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(req.method!=='GET'||pathname.startsWith('/api')||pathname==='/ws'){res.writeHead(403);res.end('Offline preview only');return;}
 const file=pathname==='/stock-home-preview'?resolve(import.meta.dirname,'../preview-artifacts/sigil-stock-home-preview.html'):pathname.startsWith('/assets/')?resolve(dist,'.'+pathname):resolve(dist,'index.html');
 if(pathname!=='/stock-home-preview'&&!file.startsWith(dist)){res.writeHead(400);res.end();return;}
 try{res.setHeader('Content-Type',extname(file)==='.js'?'application/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
}).on('upgrade',(_req,socket)=>socket.destroy()).listen(4318,'127.0.0.1',()=>console.log('http://127.0.0.1:4318/stock-home-preview'));
