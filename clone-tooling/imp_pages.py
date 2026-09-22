import sys, json, os; sys.path.insert(0,'lib')
from sh import *
pages=json.load(open('export/pages.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
def bn(u): return u.split('?')[0].split('/')[-1] if u else None
M="""mutation($p:PageCreateInput!){pageCreate(page:$p){page{id handle} userErrors{field message code}}}"""
pmapf='maps/pages.json'
pm=json.load(open(pmapf)) if os.path.exists(pmapf) else {}
existing={p['handle']:p['id'] for p in dst_all("pages.json","pages")}
ok=0; errs=[]
for p in pages:
    if p['handle'] in pm: continue
    if p['handle'] in existing:
        # delete the stock page only if it is Shopify's default and we need the handle
        pass
    inp={"handle":p['handle'],"title":p['title'],"body":p.get('body_html') or "",
         "isPublished":bool(p.get('published_at'))}
    if p.get('template_suffix'): inp['templateSuffix']=p['template_suffix']
    mfs=[]
    for m in p.get('_mf') or []:
        if m['namespace'].startswith(('shopify--','app--')) or m['namespace']=='shopify': continue
        v=m['value']
        if m['type'] in ('file_reference','list.file_reference'):
            def one(g):
                f=src_files.get(g); return dst_files.get(bn(f['url'])) if f and f.get('url') else None
            if m['type'].startswith('list.'):
                arr=[one(g) for g in json.loads(v)]; arr=[x for x in arr if x]
                if not arr: continue
                v=json.dumps(arr)
            else:
                v=one(v)
                if not v: continue
        mfs.append({"namespace":m['namespace'],"key":m['key'],"type":m['type'],"value":v})
    if mfs: inp['metafields']=mfs
    try: r=dst_gql(M,{"p":inp})['pageCreate']
    except Exception as e: errs.append((p['handle'],str(e)[:250])); continue
    if r['userErrors']: errs.append((p['handle'],json.dumps(r['userErrors'])[:250])); continue
    pm[p['handle']]=r['page']['id']; ok+=1
json.dump(pm,open(pmapf,'w'),indent=1)
print(f"pages ok={ok} errors={len(errs)}")
for h,e in errs: print("   FAIL",h,e[:220])
