import sys, json, os; sys.path.insert(0,'lib')
from sh import *
mos=json.load(open('export/metaobjects.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
pmap=json.load(open('maps/products.json'))
cmap=json.load(open('maps/collections.json'))
pgmap=json.load(open('maps/pages.json'))
prods=json.load(open('export/products.json'))
src_prod={p['id']:p['handle'] for p in prods}
src_col={c['id']:c['handle'] for c in json.load(open('export/collections.json'))}
src_page={f"gid://shopify/Page/{p['id']}":p['handle'] for p in json.load(open('export/pages.json'))}
src_var={}
for p in prods:
    for v in p['variants']['nodes']: src_var[v['id']]=(p['handle'], v.get('sku') or v['title'])
momap=json.load(open('maps/metaobjects.json')) if os.path.exists('maps/metaobjects.json') else {}
def bn(u): return u.split('?')[0].split('/')[-1] if u else None

DROPPED={}
def res_gid(g):
    """resolve ANY source GID to its destination equivalent; None = unresolvable"""
    if not isinstance(g,str) or not g.startswith('gid://shopify/'): return g
    kind=g.split('/')[3]
    if kind=='Metaobject': return momap.get(g)
    if kind=='Product':
        h=src_prod.get(g); return pmap[h]['id'] if h in pmap else None
    if kind=='ProductVariant':
        t=src_var.get(g)
        return (pmap.get(t[0]) or {}).get('variants',{}).get(t[1]) if t else None
    if kind=='Collection':
        h=src_col.get(g); return cmap[h]['id'] if h in cmap else None
    if kind=='Page':
        h=src_page.get(g); return pgmap.get(h)
    if kind in ('MediaImage','GenericFile','Video','Model3d'):
        f=src_files.get(g); return dst_files.get(bn(f['url'])) if f and f.get('url') else None
    if kind in ('TaxonomyValue','TaxonomyCategory'): return g   # global, stable across shops
    if kind=='Customer': DROPPED['customer']=DROPPED.get('customer',0)+1; return None
    DROPPED[kind]=DROPPED.get(kind,0)+1
    return None

REF_SUFFIX=('_reference',)
def is_ref(t): return t.endswith('_reference') or t.startswith('list.') and t[5:].endswith('_reference')
PASSTHRU={'product_taxonomy_value_reference','list.product_taxonomy_value_reference'}

def conv(f, allow_refs):
    t,v=f['type'],f['value']
    if v is None: return None
    if t in PASSTHRU: return v
    if not is_ref(t): return v
    if not allow_refs: return None
    if t.startswith('list.'):
        try: arr=json.loads(v)
        except: return None
        new=[res_gid(g) for g in arr]; new=[x for x in new if x]
        return json.dumps(new) if new else None
    return res_gid(v)

CREATE="""mutation($m:MetaobjectCreateInput!){metaobjectCreate(metaobject:$m){metaobject{id handle type} userErrors{field message code}}}"""
UPDATE="""mutation($id:ID!,$m:MetaobjectUpdateInput!){metaobjectUpdate(id:$id,metaobject:$m){metaobject{id} userErrors{field message code}}}"""

created=0; failed=[]
for t,lst in mos.items():
    if t.startswith('shopify--'): continue
    for e in lst:
        if e['id'] in momap: continue
        fields=[{"key":f['key'],"value":conv(f,False)} for f in e['fields']]
        fields=[f for f in fields if f['value'] is not None]
        m={"type":t,"handle":e['handle'],"fields":fields}
        cap=(e.get('capabilities') or {}).get('publishable')
        if cap and cap.get('status'): m['capabilities']={"publishable":{"status":cap['status']}}
        r=dst_gql(CREATE,{"m":m})['metaobjectCreate']
        if r['userErrors']: failed.append((t,e['handle'],json.dumps(r['userErrors'])[:220]))
        else: momap[e['id']]=r['metaobject']['id']; created+=1
json.dump(momap,open('maps/metaobjects.json','w'),indent=1)
print(f"PASS1 created={created} failed={len(failed)} total_mapped={len(momap)}")
for x in failed[:8]: print("   ",x)

upd=0; uerr=[]
for t,lst in mos.items():
    if t.startswith('shopify--'): continue
    for e in lst:
        did=momap.get(e['id'])
        if not did: continue
        fields=[]
        for f in e['fields']:
            if f['type'] in PASSTHRU or not is_ref(f['type']): continue
            v=conv(f,True)
            if v is not None: fields.append({"key":f['key'],"value":v})
        if not fields: continue
        r=dst_gql(UPDATE,{"id":did,"m":{"fields":fields}})['metaobjectUpdate']
        if r['userErrors']: uerr.append((t,e['handle'],json.dumps(r['userErrors'])[:220]))
        else: upd+=1
print(f"PASS2 ref-updates={upd} errors={len(uerr)}")
for x in uerr[:8]: print("   ",x)
print("dropped GID kinds:",DROPPED)
