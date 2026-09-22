import sys, json; sys.path.insert(0,'lib')
from sh import *
sm=json.load(open('export/shop_metafields.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
momap=json.load(open('maps/metaobjects.json'))
pmap=json.load(open('maps/products.json'))
src_prod={p['id']:p['handle'] for p in json.load(open('export/products.json'))}
def bn(u): return u.split('?')[0].split('/')[-1] if u else None
shop=dst_gql("{shop{id}}")['shop']['id']
def res(t,v):
    def onef(g):
        f=src_files.get(g); return dst_files.get(bn(f['url'])) if f and f.get('url') else None
    def onem(g): return momap.get(g)
    def onep(g):
        h=src_prod.get(g); return pmap[h]['id'] if h in pmap else None
    fn={'file_reference':onef,'list.file_reference':onef,'metaobject_reference':onem,
        'list.metaobject_reference':onem,'product_reference':onep,'list.product_reference':onep}.get(t)
    if not fn: return v
    if t.startswith('list.'):
        arr=[fn(g) for g in json.loads(v)]; arr=[x for x in arr if x]
        return json.dumps(arr) if arr else None
    return fn(v)
mfs=[]; skipped=[]
for m in sm:
    if m['namespace'].startswith(('shopify--','app--')) or m['namespace']=='shopify':
        skipped.append(f"{m['namespace']}.{m['key']}"); continue
    v=res(m['type'],m['value'])
    if v is None: skipped.append(f"{m['namespace']}.{m['key']} (unresolved refs)"); continue
    mfs.append({"namespace":m['namespace'],"key":m['key'],"type":m['type'],"value":v,"ownerId":shop})
ok=0
for i in range(0,len(mfs),25):
    r=dst_gql("mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}",{"m":mfs[i:i+25]})['metafieldsSet']
    if r['userErrors']: print("  errs:",json.dumps(r['userErrors'])[:400])
    ok+=len(r['metafields'] or [])
print(f"shop metafields set={ok} of {len(sm)}; skipped={len(skipped)}")
for s in skipped: print("   skip",s)
