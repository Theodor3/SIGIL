const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),p=__dirname;
const files=Object.fromEntries(['ledger.py','test_ledger.py','stb_parser.py','capture_once.py','test_stb_parser.py'].map(n=>[n,fs.readFileSync(p+'/'+n,'utf8')]));
const fixtureRoot=process.env.STB_FIXTURE_ROOT;
if(fixtureRoot){const fixtureFile=fixtureRoot+'/fixtures.json';files['fixtures.json']=fs.readFileSync(fixtureFile,'utf8');}
const loader=`import json,pathlib,sys,subprocess
r=pathlib.Path('/workspace/pilot');r.mkdir()
for n,s in json.load(sys.stdin).items(): (r/n).write_text(s)
sys.exit(subprocess.call([sys.executable,'-m','pytest','-q','test_ledger.py','test_stb_parser.py'],cwd=r))`;
const args=['--host','npipe:////./pipe/dockerDesktopLinuxEngine','run','--rm','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65534:65534','--pids-limit','64','--memory','256m','--cpus','1','--tmpfs','/workspace:rw,size=16m,uid=65534,gid=65534','--tmpfs','/tmp:rw,size=16m,uid=65534,gid=65534','c2ddeeec7f32','python','-c',loader];
const r=cp.spawnSync('docker',args,{input:JSON.stringify(files),encoding:'utf8',maxBuffer:1024*1024});fs.writeFileSync(p+'/tests.txt',(r.stdout||'')+(r.stderr||''));process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);
