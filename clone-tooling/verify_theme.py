import sys, json, hashlib, base64; sys.path.insert(0,'lib')
from sh import *
SRC_T=191188009144; DST_T=json.load(open('maps/theme.json'))['id']
s={a['key'] for a in src_get(f"themes/{SRC_T}/assets.json")['assets']}
d={a['key'] for a in dst_get(f"themes/{DST_T}/assets.json")['assets']}
print("src",len(s),"dst",len(d),"missing",sorted(s-d),"extra",sorted(d-s))
def body(store_get,tid,k):
    a=store_get(f"themes/{tid}/assets.json?asset[key]={k.replace(' ','%20')}")['asset']
    if a.get('value') is not None: return hashlib.sha256(a['value'].encode()).hexdigest()
    if a.get('attachment'): return hashlib.sha256(base64.b64decode(a['attachment'])).hexdigest()
    return "url:"+ (a.get('public_url','').split('/')[-1].split('?')[0])
diff=[]; same=0
for i,k in enumerate(sorted(s&d),1):
    try:
        if body(src_get,SRC_T,k)==body(dst_get,DST_T,k): same+=1
        else: diff.append(k)
    except Exception as e: diff.append(f"{k} ERR {str(e)[:60]}")
    if i%50==0: print(f"  {i}/{len(s&d)} identical={same}",flush=True)
print(f"IDENTICAL {same}/{len(s&d)}")
for k in diff: print("  DIFF",k)
