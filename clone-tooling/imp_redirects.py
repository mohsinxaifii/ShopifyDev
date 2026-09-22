import sys, json; sys.path.insert(0,'lib')
from sh import *
rs=src_all("redirects.json","redirects")
have={r['path'] for r in dst_all("redirects.json","redirects")}
ok=0
for r in rs:
    if r['path'] in have: continue
    try:
        dst("POST","redirects.json",{"redirect":{"path":r['path'],"target":r['target']}}); ok+=1
    except Exception as e: print("  FAIL",r['path'],str(e)[:150])
print(f"redirects created={ok} of {len(rs)}")
