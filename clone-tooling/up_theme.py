import sys, json, os, base64, time; sys.path.insert(0,'lib')
from sh import *
TID=json.load(open('maps/theme.json'))['id']
ROOT="/home/mvenstrix/ShopifyDev/ShopifyDev/Zinara-X-Revolv-V6"
TEXT={'.liquid','.json','.js','.css','.scss','.svg','.txt','.html','.md'}
files=[]
for r,_,fs in os.walk(ROOT):
    for f in fs:
        p=os.path.join(r,f); key=os.path.relpath(p,ROOT).replace(os.sep,'/')
        files.append((key,p))
# upload order: config/settings_schema first, then assets/snippets/sections, then templates & layout last
def rank(k):
    if k.startswith('config/settings_schema'): return 0
    if k.startswith('assets/') or k.startswith('locales/'): return 1
    if k.startswith('snippets/'): return 2
    if k.startswith('blocks/'): return 3
    if k.startswith('sections/'): return 4
    if k.startswith('layout/'): return 5
    if k.startswith('templates/'): return 6
    return 7
files.sort(key=lambda x: (rank(x[0]), x[0]))
ok=err=0; errors=[]
for i,(key,path) in enumerate(files,1):
    ext=os.path.splitext(key)[1].lower()
    try:
        if ext in TEXT:
            body={"asset":{"key":key,"value":open(path,encoding='utf-8').read()}}
        else:
            body={"asset":{"key":key,"attachment":base64.b64encode(open(path,'rb').read()).decode()}}
        dst("PUT",f"themes/{TID}/assets.json",body); ok+=1
    except Exception as e:
        err+=1; errors.append((key,str(e)[:200]))
    if i%40==0: print(f"  {i}/{len(files)} ok={ok} err={err}",flush=True)
    time.sleep(0.12)
print(f"THEME UPLOAD DONE ok={ok} err={err}")
for k,e in errors: print("  FAIL",k,e[:160])
