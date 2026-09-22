import sys, os, json, base64, time
sys.path.insert(0,'lib')
from sh import *
THEME=191188009144
OUT="/home/mvenstrix/ShopifyDev/ShopifyDev/Zinara-X-Revolv-V6"
assets = src_get(f"themes/{THEME}/assets.json")["assets"]
os.makedirs(OUT, exist_ok=True)
ok=err=0; errors=[]
for i,a in enumerate(assets,1):
    key=a['key']; dest=os.path.join(OUT,key)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        d = src_get(f"themes/{THEME}/assets.json?asset[key]={key.replace(' ','%20')}")['asset']
        if d.get('value') is not None:
            open(dest,'w',encoding='utf-8').write(d['value'])
        elif d.get('attachment'):
            open(dest,'wb').write(base64.b64decode(d['attachment']))
        elif d.get('public_url'):
            import urllib.request
            urllib.request.urlretrieve(d['public_url'], dest)
        else:
            raise RuntimeError("no content field")
        ok+=1
    except Exception as e:
        err+=1; errors.append((key,str(e)[:160]))
    if i%40==0: print(f"  {i}/{len(assets)} ok={ok} err={err}", flush=True)
print(f"DONE ok={ok} err={err}")
for k,e in errors: print("  FAIL",k,e)
