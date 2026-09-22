import sys, json, os, time; sys.path.insert(0,'lib')
from sh import *
cols=json.load(open('export/collections.json'))
pmap=json.load(open('maps/products.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
def bn(u): return u.split('?')[0].split('/')[-1] if u else None

# metafield def namespace->key map for smart rules
dst_defs={}
for n in dst_gql('{metafieldDefinitions(first:250,ownerType:PRODUCT){nodes{id namespace key}}}')['metafieldDefinitions']['nodes']:
    dst_defs[(n['namespace'],n['key'])]=n['id']

C="""mutation($i:CollectionInput!){collectionCreate(input:$i){collection{id handle} userErrors{field message}}}"""
cmap=json.load(open('maps/collections.json')) if os.path.exists('maps/collections.json') else {}
ok=0; errs=[]
for c in cols:
    if c['handle'] in cmap: continue
    inp={"handle":c['handle'],"title":c['title'],"descriptionHtml":c.get('descriptionHtml') or ""}
    if c.get('sortOrder'): inp['sortOrder']=c['sortOrder']
    if c.get('templateSuffix'): inp['templateSuffix']=c['templateSuffix']
    seo={k:v for k,v in (c.get('seo') or {}).items() if v}
    if seo: inp['seo']=seo
    img=(c.get('image') or {})
    if img.get('url'):
        inp['image']={"src":img['url']}
        if img.get('altText'): inp['image']['altText']=img['altText']
    rs=c.get('ruleSet')
    if rs:
        rules=[]
        for r in rs['rules']:
            rr={"column":r['column'],"relation":r['relation'],"condition":r['condition']}
            co=r.get('conditionObject') or {}
            md=co.get('metafieldDefinition')
            if md:
                did=dst_defs.get((md['namespace'],md['key']))
                if not did: continue
                rr['conditionObjectId']=did
            rules.append(rr)
        inp['ruleSet']={"appliedDisjunctively":rs['appliedDisjunctively'],"rules":rules}
    mfs=[m for m in c['metafields']['nodes'] if not m['namespace'].startswith(('shopify--','app--')) and m['namespace']!='shopify']
    fixed=[]
    for m in mfs:
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
        fixed.append({"namespace":m['namespace'],"key":m['key'],"type":m['type'],"value":v})
    if fixed: inp['metafields']=fixed
    try: r=dst_gql(C,{"i":inp})['collectionCreate']
    except Exception as e: errs.append((c['handle'],str(e)[:200])); continue
    if r['userErrors']: errs.append((c['handle'],json.dumps(r['userErrors'])[:250])); continue
    cmap[c['handle']]={"id":r['collection']['id'],"smart":bool(rs)}
    ok+=1
    # manual collection -> add products
    if not rs:
        pids=[pmap[p['handle']]['id'] for p in c['products']['nodes'] if p['handle'] in pmap]
        for i in range(0,len(pids),200):
            rr=dst_gql("""mutation($id:ID!,$p:[ID!]!){collectionAddProducts(id:$id,productIds:$p){userErrors{message}}}""",
                       {"id":r['collection']['id'],"p":pids[i:i+200]})
            if rr['collectionAddProducts']['userErrors']: print("  addprod err",rr)
        print(f"  manual collection {c['handle']}: {len(pids)} products")
json.dump(cmap,open('maps/collections.json','w'),indent=1)
print(f"collections ok={ok} errors={len(errs)}")
for h,e in errs: print("   FAIL",h,e[:200])
