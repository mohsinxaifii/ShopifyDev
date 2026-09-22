import sys, json, os; sys.path.insert(0,'lib')
from sh import *
mos=json.load(open('export/metaobjects.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
pmap=json.load(open('maps/products.json'))
src_prod_by_gid={}
for p in json.load(open('export/products.json')): src_prod_by_gid[p['id']]=p['handle']
prod_gid={f"gid://shopify/Product/{0}":None}
dst_prod={h:v['id'] for h,v in pmap.items()}

REF_MO={'metaobject_reference','list.metaobject_reference'}
REF_P={'product_reference','list.product_reference'}
REF_F={'file_reference','list.file_reference'}

momap=json.load(open('maps/metaobjects.json')) if os.path.exists('maps/metaobjects.json') else {}

def bn(u): return u.split('?')[0].split('/')[-1] if u else None
def res_file(g):
    f=src_files.get(g)
    return dst_files.get(bn(f['url'])) if f and f.get('url') else None
def res_prod(g):
    h=src_prod_by_gid.get(g)
    return dst_prod.get(h) if h else None
def res_mo(g): return momap.get(g)

def conv(field, allow_refs):
    t,v=field['type'],field['value']
    if v is None: return None
    if t in REF_F or t in REF_P or t in REF_MO:
        if not allow_refs: return None
        fn={**{k:res_file for k in REF_F},**{k:res_prod for k in REF_P},**{k:res_mo for k in REF_MO}}[t]
        if t.startswith('list.'):
            try: arr=json.loads(v)
            except: return None
            new=[fn(g) for g in arr]; new=[x for x in new if x]
            return json.dumps(new) if new else None
        return fn(v)
    return v

CREATE="""mutation($m:MetaobjectCreateInput!){metaobjectCreate(metaobject:$m){metaobject{id handle type} userErrors{field message code}}}"""
UPDATE="""mutation($id:ID!,$m:MetaobjectUpdateInput!){metaobjectUpdate(id:$id,metaobject:$m){metaobject{id} userErrors{field message code}}}"""

order=sorted(mos.keys(), key=lambda t: 0 if t.startswith('shopify--') else 1)
# PASS 1: create with non-reference fields
created=0; failed=[]
for t in order:
    if t.startswith('shopify--'): continue
    for e in mos[t]:
        if e['id'] in momap: continue
        fields=[]
        for f in e['fields']:
            v=conv(f, allow_refs=False)
            if v is not None: fields.append({"key":f['key'],"value":v})
        m={"type":t,"handle":e['handle'],"fields":fields}
        cap=(e.get('capabilities') or {}).get('publishable')
        if cap and cap.get('status'): m['capabilities']={"publishable":{"status":cap['status']}}
        r=dst_gql(CREATE,{"m":m})['metaobjectCreate']
        if r['userErrors']: failed.append((t,e['handle'],json.dumps(r['userErrors'])[:200]))
        else: momap[e['id']]=r['metaobject']['id']; created+=1
json.dump(momap,open('maps/metaobjects.json','w'),indent=1)
print(f"PASS1 created={created} failed={len(failed)}")
for x in failed[:10]: print("   ",x)

# PASS 2: fill reference fields now that all entries + products exist
upd=0; uerr=[]
for t in order:
    if t.startswith('shopify--'): continue
    for e in mos[t]:
        did=momap.get(e['id'])
        if not did: continue
        fields=[]
        for f in e['fields']:
            if f['type'] in REF_F|REF_P|REF_MO:
                v=conv(f, allow_refs=True)
                if v is not None: fields.append({"key":f['key'],"value":v})
        if not fields: continue
        r=dst_gql(UPDATE,{"id":did,"m":{"fields":fields}})['metaobjectUpdate']
        if r['userErrors']: uerr.append((t,e['handle'],json.dumps(r['userErrors'])[:200]))
        else: upd+=1
print(f"PASS2 updated={upd} errors={len(uerr)}")
for x in uerr[:10]: print("   ",x)
