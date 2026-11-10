import {build} from 'esbuild';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const result=await build({stdin:{contents:"import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Preview from './src/pages/StockIdeasPreview';createRoot(document.getElementById('root')).render(<MemoryRouter><Preview/></MemoryRouter>);",resolveDir:process.cwd(),sourcefile:'preview-entry.tsx',loader:'tsx'},bundle:true,write:false,outfile:'preview.js',format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=readFileSync(resolve('dist/assets',readdirSync('dist/assets').find(file=>file.endsWith('.css'))),'utf8');
mkdirSync('preview-artifacts',{recursive:true});
writeFileSync('preview-artifacts/sigil-stock-home-preview.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'"><title>Sigil stock-first home preview</title><style>'+css+'</style></head><body><div id="root"></div><script>'+js.replaceAll('</script','<\\/script')+'</script></body></html>');
console.log('Wrote self-contained offline preview');
