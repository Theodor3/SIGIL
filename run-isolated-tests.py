"""Trusted test harness: create a synthetic Git checkout only INSIDE Docker /tmp."""
import pathlib,shutil,subprocess,sys
root=pathlib.Path('/tmp/project')
shutil.copytree('/lab',root,ignore=shutil.ignore_patterns('.git','.swarm','.env','node_modules','__pycache__','.pytest_cache'))
for args in (['init'],['config','user.name','Synthetic Test'],['config','user.email','test@invalid'],['add','.'],['commit','-qm','Synthetic source fixture']):
    subprocess.run(['git',*args],cwd=root,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
sys.exit(subprocess.run([sys.executable,'-m','pytest','swarm/tests','-q','-p','no:cacheprovider'],cwd=root).returncode)
