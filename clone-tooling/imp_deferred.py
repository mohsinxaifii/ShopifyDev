import sys, json, os; sys.path.insert(0,'lib')
from sh import *
deferred=json.load(open('maps/deferred_mf.json'))
pmap=json.load(open('maps/products.json'))
cmap=json.load(open('maps/collections.json')) if os.path.exists('maps/collections.json') else {}
pgmap=json.load(open('maps/pages.json')) if os.path.exists('maps/pages.json') else {}
momap=json.load(open('maps/metaobjects.json')) if os.path.exists('maps/metaobjects.json') else {}
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
prods=json.load(open('export/products.json'))
src_prod={p['id']:p['handle'] for p in prods}
src_col={c['id']:c['handle'] for c in json.load(open('export/collections.json'))}
src_page={f"gid://shopify/Page/{p['id']}":p['handle'] for p in json.load(open('export/pages.json'))}
src_var={}
for p in prods:
    for v in p['variants']['nodes']: src_var[v['id']]=(p['handle'], v.get('sku') or v['title'])
def bn(u): return u.split('?')[0].split('/')[-1] if u else None
def onef(g):
    f=src_files.get(g); return dst_files.get(bn(f['url'])) if f and f.get('url') else None
def onep(g):
    h=src_prod.get(g); return pmap[h]['id'] if h in pmap else None
def onem(g): return momap.get(g)
def onec(g):
    h=src_col.get(g); return cmap[h]['id'] if h in cmap else None
def onepg(g):
    h=src_page.get(g); return pgmap.get(h)
def onev(g):
    t=src_var.get(g)
    if not t: return None
    return (pmap.get(t[0]) or {}).get('variants',{}).get(t[1])
FN={'file_reference':onef,'list.file_reference':onef,'product_reference':onep,'list.product_reference':onep,
    'metaobject_reference':onem,'list.metaobject_reference':onem,'collection_reference':onec,
    'list.collection_reference':onec,'page_reference':onepg,'list.page_reference':onepg,
    'variant_reference':onev,'list.variant_reference':onev}
inputs=[]; unresolved={}
for d in deferred:
    fn=FN.get(d['type'])
    if not fn: continue
    owner=d['owner'].split('::')
    if owner[0]=='product':
        oid=(pmap.get(owner[1]) or {}).get('id')
    else:
        e=pmap.get(owner[1]) or {}
        oid=(e.get('variants') or {}).get(owner[2])
    if not oid: unresolved.setdefault('owner-missing',0); unresolved['owner-missing']+=1; continue
    v=d['value']
    if d['type'].startswith('list.'):
        try: arr=json.loads(v)
        except: continue
        new=[fn(g) for g in arr]
        lost=sum(1 for x in new if x is None)
        if lost: unresolved[f"{d['namespace']}.{d['key']}"]=unresolved.get(f"{d['namespace']}.{d['key']}",0)+lost
        new=[x for x in new if x]
        if not new: continue
        v=json.dumps(new)
    else:
        v=fn(v)
        if v is None:
            unresolved[f"{d['namespace']}.{d['key']}"]=unresolved.get(f"{d['namespace']}.{d['key']}",0)+1
            continue
    inputs.append({"namespace":d['namespace'],"key":d['key'],"type":d['type'],"value":v,"ownerId":oid})
print("deferred metafields to set:",len(inputs),"of",len(deferred))
ok=0; errs=[]
for i in range(0,len(inputs),25):
    r=dst_gql("mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}",
              {"m":inputs[i:i+25]})['metafieldsSet']
    if r['userErrors']: errs+=r['userErrors']
    ok+=len(r['metafields'] or [])
    if (i//25)%20==0: print(f"  {min(i+25,len(inputs))}/{len(inputs)}",flush=True)
print(f"set={ok} errors={len(errs)}")
for e in errs[:10]: print("   ",json.dumps(e)[:200])
if unresolved:
    print("unresolved references (source rows pointing at data not cloned):")
    for k,v in sorted(unresolved.items(),key=lambda x:-x[1]): print(f"   {k}: {v}")
