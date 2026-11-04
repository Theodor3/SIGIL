"""Presentation-only normalization for a frozen renderer; never changes forecasts or code."""
import hashlib,json,re
from pathlib import Path

def normalize(root):
 path=root/'index.html';before=path.read_text(encoding='utf-8')
 after=re.sub(r'<title>[^<]*</title>','<title>Sigil - Company growth study</title>',before,count=1)
 after=re.sub(r'Forecast frozen[^<]*outcome pending','Forecast frozen - outcome pending',after)
 if re.findall(r'\d+',before)!=re.findall(r'\d+',after):raise ValueError('Display normalization would change numbers')
 path.write_text(after,encoding='utf-8')
 result={'presentation_only':True,'numeric_tokens_unchanged':True,'before_sha256':hashlib.sha256(before.encode()).hexdigest(),'after_sha256':hashlib.sha256(after.encode()).hexdigest(),'frozen_engine_and_records_modified':False}
 (root/'display-normalization.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 return result
if __name__=='__main__':print(json.dumps(normalize(Path(__file__).parent),indent=2))
