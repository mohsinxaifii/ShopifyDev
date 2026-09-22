import sys, json, time, os; sys.path.insert(0,'lib')
from sh import *
byid=json.load(open('export/files_byid.json'))
want=json.load(open('export/files_upload.json'))
MAPF='maps/files.json'
fmap=json.load(open(MAPF)) if os.path.exists(MAPF) else {}
M="""mutation($f:[FileCreateInput!]!){fileCreate(files:$f){
 files{ id fileStatus alt ... on MediaImage{image{url}} ... on Video{filename} ... on GenericFile{url} }
 userErrors{field message code}}}"""
todo=[g for g in want if g not in fmap]
print("to upload:",len(todo))
B=20
for i in range(0,len(todo),B):
    chunk=todo[i:i+B]; inputs=[]
    for g in chunk:
        f=byid[g]; url=f['url']
        if not url: continue
        name=url.split('?')[0].split('/')[-1]
        ct = "VIDEO" if f['type']=='Video' else ("IMAGE" if f['type']=='MediaImage' else "FILE")
        d={"originalSource":url,"contentType":ct,"filename":name}
        if f.get('alt'): d['alt']=f['alt']
        inputs.append((g,d))
    if not inputs: continue
    r=dst_gql(M,{"f":[d for _,d in inputs]})['fileCreate']
    if r['userErrors']: print("  errs:",json.dumps(r['userErrors'])[:400])
    for (g,_),nf in zip(inputs, r['files'] or []):
        fmap[g]={"id":nf['id']}
    json.dump(fmap,open(MAPF,'w'),indent=1)
    print(f"  {min(i+B,len(todo))}/{len(todo)}", flush=True)
    time.sleep(0.4)
print("uploaded map size:",len(fmap))
